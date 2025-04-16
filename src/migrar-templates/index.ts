import { Rule, SchematicContext, Tree } from "@angular-devkit/schematics"; // <- SchematicsException eliminado
import { dirname, join, basename, normalize } from "path";
import * as ts from "typescript"; // Necesitarás 'npm install typescript --save-dev'

// --- Funciones Auxiliares para analizar el AST de TypeScript ---

/**
 * Encuentra el nodo ObjectLiteralExpression dentro del decorador @Component.
 */
function findComponentDecorator(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let componentDecorator: ts.ObjectLiteralExpression | null = null;

  function visitNode(node: ts.Node) {
    // Usar ts.canHaveDecorators para chequear si el nodo puede tener decoradores (más moderno)
    if (ts.canHaveDecorators && ts.canHaveDecorators(node) && ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators(node);
      if (decorators) {
        for (const decorator of decorators) {
          if (ts.isCallExpression(decorator.expression)) {
            const expression = decorator.expression;
            if (ts.isIdentifier(expression.expression) && expression.expression.text === "Component") {
              if (expression.arguments.length > 0 && ts.isObjectLiteralExpression(expression.arguments[0])) {
                componentDecorator = expression.arguments[0];
                return; // Encontrado, detener búsqueda
              }
            }
          }
        }
      }
    }
    if (!componentDecorator) {
      // Continuar buscando si no se ha encontrado
      ts.forEachChild(node, visitNode);
    }
  }

  visitNode(sourceFile);
  return componentDecorator;
}

/**
 * Obtiene el valor de una propiedad específica (como 'template' o 'templateUrl') del decorador.
 */
function getDecoratorPropertyValue(decorator: ts.ObjectLiteralExpression, propertyName: string): string | undefined {
  const property = decorator.properties.find(
    (
      prop
    ): prop is ts.PropertyAssignment => // Type guard para asegurar que es PropertyAssignment
      ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName
  );

  if (property) {
    // Ya sabemos que es PropertyAssignment gracias al type guard
    const initializer = property.initializer;
    // Maneja strings literales ('...') y template literals (`...`)
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      return initializer.text;
    }
    // Podrías añadir manejo para otros casos si fuera necesario (ej: identificadores)
  }
  return undefined;
}

/**
 * Encuentra el nodo de una propiedad específica dentro del decorador.
 */
function getDecoratorPropertyNode(
  decorator: ts.ObjectLiteralExpression,
  propertyName: string
): ts.PropertyAssignment | null {
  const property = decorator.properties.find(
    (
      prop
    ): prop is ts.PropertyAssignment => // Type guard
      ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName
  );
  return property || null; // Si find no lo encuentra, devuelve undefined, que se convierte en null con ||
}

// --- Regla Principal del Schematic ---

export function migrarTemplates(): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.info("Buscando componentes con templates inline...");

    tree.getDir("/").visit((filePath) => {
      // Procesar solo archivos *.component.ts
      if (!filePath.endsWith(".component.ts")) {
        return;
      }

      const fileBuffer = tree.read(filePath);
      if (!fileBuffer) {
        context.logger.warn(`No se pudo leer el archivo: ${filePath}`);
        return;
      }

      const content = fileBuffer.toString("utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true // setParentNodes es importante para el análisis
      );

      // Encontrar el decorador @Component
      const componentDecorator = findComponentDecorator(sourceFile);
      if (!componentDecorator) {
        // No es un componente Angular estándar o no tiene decorador, omitir
        return;
      }

      // Verificar si ya tiene templateUrl
      const hasTemplateUrl = componentDecorator.properties.some(
        (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "templateUrl"
      );

      if (hasTemplateUrl) {
        context.logger.debug(`Omitiendo ${filePath}: ya tiene templateUrl.`);
        return; // Ya tiene templateUrl, no hacer nada
      }

      // Buscar la propiedad 'template' y obtener su contenido
      const templateContent = getDecoratorPropertyValue(componentDecorator, "template");

      if (templateContent === undefined) {
        // No tiene 'templateUrl' ni 'template', omitir
        context.logger.debug(`Omitiendo ${filePath}: no se encontró template inline.`);
        return;
      }

      // --- Acciones Requeridas ---
      context.logger.info(`Procesando ${filePath}: migrando template inline.`);

      // 1. Determinar la ruta del nuevo archivo HTML
      const componentDir = dirname(filePath);
      const componentBaseName = basename(filePath, ".ts"); // ej: 'mi-componente.component'
      const htmlFileName = `${componentBaseName}.html`; // ej: 'mi-componente.component.html'
      const htmlFilePath = normalize(join(componentDir, htmlFileName));
      const relativeHtmlPath = `./${htmlFileName}`; // Ruta relativa para templateUrl

      // 2. Crear el archivo HTML (si no existe)
      if (tree.exists(htmlFilePath)) {
        context.logger.warn(`El archivo HTML ya existe, se omitirá la creación: ${htmlFilePath}`);
        // Podrías decidir sobrescribir o parar aquí. Omitir es más seguro.
        // Si quisieras sobrescribir: tree.overwrite(htmlFilePath, templateContent);
      } else {
        tree.create(htmlFilePath, templateContent);
        context.logger.debug(`Creado ${htmlFilePath}`);
      }

      // 3. Actualizar el archivo .ts
      const templatePropertyNode = getDecoratorPropertyNode(componentDecorator, "template");
      if (!templatePropertyNode) {
        // Esto no debería pasar si templateContent fue encontrado, pero es una buena verificación
        context.logger.error(
          `Error crítico: No se encontró el nodo de la propiedad 'template' en ${filePath} después de obtener su contenido.`
        );
        return; // Omitir actualización para este archivo
      }

      // Construir la nueva propiedad templateUrl
      const newTemplateUrlProperty = `templateUrl: '${relativeHtmlPath}'`;

      const recorder = tree.beginUpdate(filePath);
      const properties = componentDecorator.properties;
      // const templatePropertyIndex = properties.indexOf(templatePropertyNode); // <- Eliminado

      // --- Lógica Modificada para Calcular el Rango de Eliminación ---
      let removalStart = templatePropertyNode.getFullStart(); // Incluye trivia inicial (espacios, comentarios)
      let removalEnd = templatePropertyNode.getEnd(); // Fin del nodo en sí
      let needsCommaInserted = false; // Flag para saber si la nueva propiedad necesita una coma al final

      if (properties.length > 1) {
        // Solo ajustar comas/espacios si hay más de una propiedad
        const textAfterNode = sourceFile.text.substring(templatePropertyNode.getEnd());
        // Busca una coma opcionalmente precedida por espacios después del nodo actual
        const commaMatchAfter = textAfterNode.match(/^\s*,/);

        if (commaMatchAfter) {
          // Si hay una coma después (no era la última propiedad),
          // extender la eliminación para incluir esa coma y los espacios anteriores a ella.
          removalEnd += commaMatchAfter[0].length;
          // La propiedad insertada también necesitará una coma, ya que no será la última.
          needsCommaInserted = true;
        } else {
          // Si no hay coma después, significa que era la última propiedad.
          // Buscar una coma opcionalmente seguida de espacios *antes* del inicio completo del nodo actual.
          const textBeforeNode = sourceFile.text.substring(0, templatePropertyNode.getFullStart());
          const commaMatchBefore = textBeforeNode.match(/,\s*$/);
          if (commaMatchBefore) {
            // Si hay una coma antes, ajustar el inicio de la eliminación
            // para incluir esa coma y los espacios posteriores a ella.
            removalStart -= commaMatchBefore[0].length;
            // La propiedad insertada será la nueva última, por lo que no necesita coma.
            needsCommaInserted = false;
          }
          // Si no hay coma antes ni después (y properties.length > 1), algo es raro,
          // pero la lógica por defecto de eliminar solo el nodo podría funcionar.
          // Si properties.length === 1, no se hace nada aquí, solo se elimina el nodo.
        }
      }
      // --- Fin de la Lógica Modificada ---

      // Eliminar la propiedad 'template' antigua y su formato asociado (coma/espacios)
      recorder.remove(removalStart, removalEnd - removalStart);

      // Construir el texto a insertar
      const textToInsert = `${newTemplateUrlProperty}${needsCommaInserted ? "," : ""}`;

      // Insertar la nueva propiedad 'templateUrl' en la posición donde comenzaba el código original del nodo eliminado
      // (usando getStart() en lugar de getFullStart() para evitar insertar antes de los comentarios/espacios iniciales)
      recorder.insertLeft(templatePropertyNode.getStart(sourceFile), textToInsert);

      // Aplicar los cambios al árbol virtual
      tree.commitUpdate(recorder);
      context.logger.info(`Actualizado ${filePath}: se reemplazó 'template' por 'templateUrl'.`);
    });

    context.logger.info("Migración de templates inline completada.");
    return tree;
  };
}
