import { Rule, SchematicContext, Tree } from "@angular-devkit/schematics"; // <- SchematicsException removed
import { dirname, join, basename, normalize } from "path";
import * as ts from "typescript"; // You'll need 'npm install typescript --save-dev'

// --- Helper Functions for TypeScript AST Analysis ---

/**
 * Finds the ObjectLiteralExpression node within the @Component decorator.
 */
function findComponentDecorator(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let componentDecorator: ts.ObjectLiteralExpression | null = null;

  function visitNode(node: ts.Node) {
    // Use ts.canHaveDecorators to check if the node can have decorators (more modern)
    if (ts.canHaveDecorators && ts.canHaveDecorators(node) && ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators(node);
      if (decorators) {
        for (const decorator of decorators) {
          if (ts.isCallExpression(decorator.expression)) {
            const expression = decorator.expression;
            if (ts.isIdentifier(expression.expression) && expression.expression.text === "Component") {
              if (expression.arguments.length > 0 && ts.isObjectLiteralExpression(expression.arguments[0])) {
                componentDecorator = expression.arguments[0];
                return; // Found, stop searching
              }
            }
          }
        }
      }
    }
    if (!componentDecorator) {
      // Continue searching if not found
      ts.forEachChild(node, visitNode);
    }
  }

  visitNode(sourceFile);
  return componentDecorator;
}

/**
 * Gets the value of a specific property (like 'template' or 'templateUrl') from the decorator.
 */
function getDecoratorPropertyValue(decorator: ts.ObjectLiteralExpression, propertyName: string): string | undefined {
  const property = decorator.properties.find(
    (
      prop
    ): prop is ts.PropertyAssignment => // Type guard to ensure it's a PropertyAssignment
      ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName
  );

  if (property) {
    // We already know it's PropertyAssignment thanks to the type guard
    const initializer = property.initializer;
    // Handles string literals ('...') and template literals (`...`)
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      return initializer.text;
    }
    // You could add handling for other cases if necessary (e.g., identifiers)
  }
  return undefined;
}

/**
 * Finds the node of a specific property within the decorator.
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
  return property || null; // If find doesn't find it, it returns undefined, which becomes null with ||
}

// --- Main Schematic Rule ---

export function migrarTemplates(): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.info("🚀 Iniciando búsqueda de componentes con plantillas en línea...");

    tree.getDir("/").visit((filePath) => {
      // Log principal para cada archivo
      context.logger.info(`\n🔍 Analizando archivo: ${filePath}`);

      // Process only *.component.ts files
      if (!filePath.endsWith(".component.ts")) {
        context.logger.debug(`  ➡️ Omitiendo (no es un archivo .component.ts)`);
        return;
      }
      context.logger.debug(`  ✅ Es un archivo .component.ts, continuando...`);

      const fileBuffer = tree.read(filePath);
      if (!fileBuffer) {
        context.logger.warn(`  ⚠️ No se pudo leer el archivo: ${filePath}`);
        return;
      }
      context.logger.debug(`  📄 Archivo leído correctamente.`);

      const content = fileBuffer.toString("utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true // setParentNodes is important for analysis
      );
      context.logger.debug(`  🌳 Archivo parseado a AST de TypeScript.`);

      // Find the @Component decorator
      context.logger.debug(`  🔎 Buscando el decorador @Component...`);
      const componentDecorator = findComponentDecorator(sourceFile);
      if (!componentDecorator) {
        context.logger.debug(`  ❌ Decorador @Component no encontrado o no es estándar. Omitiendo.`);
        return;
      }
      context.logger.debug(`  👍 Decorador @Component encontrado.`);

      // Check if it already has templateUrl
      context.logger.debug(`  🔎 Verificando si ya existe 'templateUrl'...`);
      const hasTemplateUrl = componentDecorator.properties.some(
        (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "templateUrl"
      );

      if (hasTemplateUrl) {
        context.logger.info(`  ➡️ Omitiendo ${filePath}: ya tiene 'templateUrl'.`);
        return; // Already has templateUrl, do nothing
      }
      context.logger.debug(`  👍 No tiene 'templateUrl', buscando 'template' en línea...`);

      // Find the 'template' property and get its content
      const templateContent = getDecoratorPropertyValue(componentDecorator, "template");

      if (templateContent === undefined) {
        context.logger.info(`  ➡️ Omitiendo ${filePath}: no se encontró propiedad 'template' en línea.`);
        return;
      }
      context.logger.debug(`  👍 Propiedad 'template' encontrada con contenido.`);

      // --- Required Actions ---
      context.logger.info(`  ✨ Procesando ${filePath}: Migrando plantilla en línea a archivo externo.`);

      // 1. Determine the path for the new HTML file
      context.logger.debug(`    📝 Determinando ruta para el nuevo archivo HTML...`);
      const componentDir = dirname(filePath);
      const componentBaseName = basename(filePath, ".ts"); // e.g., 'my-component.component'
      const htmlFileName = `${componentBaseName}.html`; // e.g., 'my-component.component.html'
      const htmlFilePath = normalize(join(componentDir, htmlFileName));
      const relativeHtmlPath = `./${htmlFileName}`; // Relative path for templateUrl
      context.logger.debug(`    📂 Ruta del archivo HTML: ${htmlFilePath}`);
      context.logger.debug(`    🔗 Ruta relativa para templateUrl: ${relativeHtmlPath}`);

      // 2. Create the HTML file (if it doesn't exist)
      context.logger.debug(`    🔎 Verificando si el archivo HTML ya existe...`);
      if (tree.exists(htmlFilePath)) {
        context.logger.warn(`    ⚠️ El archivo HTML ya existe, se omitirá la creación: ${htmlFilePath}`);
        // You could decide to overwrite or stop here. Skipping is safer.
        // If you wanted to overwrite: tree.overwrite(htmlFilePath, templateContent);
      } else {
        context.logger.debug(`    ➕ Creando archivo HTML: ${htmlFilePath}...`);
        tree.create(htmlFilePath, templateContent);
        context.logger.debug(`    ✅ Archivo HTML creado.`);
      }

      // 3. Update the .ts file
      context.logger.debug(`    🔄 Actualizando archivo TypeScript (${filePath})...`);
      const templatePropertyNode = getDecoratorPropertyNode(componentDecorator, "template");
      if (!templatePropertyNode) {
        // This shouldn't happen if templateContent was found, but it's a good check
        context.logger.error(
          `    ❌ Error crítico: No se pudo encontrar el nodo de la propiedad 'template' en ${filePath} después de obtener su contenido. Omitiendo actualización.`
        );
        return; // Skip update for this file
      }
      context.logger.debug(`    👍 Nodo de la propiedad 'template' encontrado.`);

      // Build the new templateUrl property
      const newTemplateUrlProperty = `templateUrl: '${relativeHtmlPath}'`;
      context.logger.debug(`    🔧 Construyendo nueva propiedad: ${newTemplateUrlProperty}`);

      const recorder = tree.beginUpdate(filePath);
      const properties = componentDecorator.properties;
      context.logger.debug(`    📐 Calculando rango para eliminar la propiedad 'template' y manejar comas...`);

      // --- Modified Logic for Calculating Removal Range ---
      let removalStart = templatePropertyNode.getFullStart(); // Includes leading trivia (spaces, comments)
      let removalEnd = templatePropertyNode.getEnd(); // End of the node itself
      let needsCommaInserted = false; // Flag to know if the new property needs a trailing comma

      if (properties.length > 1) {
        // Only adjust commas/spaces if there is more than one property
        const textAfterNode = sourceFile.text.substring(templatePropertyNode.getEnd());
        // Look for a comma optionally preceded by spaces after the current node
        const commaMatchAfter = textAfterNode.match(/^\s*,/);

        if (commaMatchAfter) {
          // If there is a comma after (it wasn't the last property),
          // extend the removal to include that comma and the spaces before it.
          removalEnd += commaMatchAfter[0].length;
          // The inserted property will also need a comma, as it won't be the last one.
          needsCommaInserted = true;
          context.logger.debug(`      Found comma after, extending removal range. New property will need a comma.`);
        } else {
          // If there's no comma after, it means it was the last property.
          // Look for a comma optionally followed by spaces *before* the full start of the current node.
          const textBeforeNode = sourceFile.text.substring(0, templatePropertyNode.getFullStart());
          const commaMatchBefore = textBeforeNode.match(/,\s*$/);
          if (commaMatchBefore) {
            // If there is a comma before, adjust the start of the removal
            // to include that comma and the spaces after it.
            removalStart -= commaMatchBefore[0].length;
            // The inserted property will be the new last one, so it doesn't need a comma.
            needsCommaInserted = false;
            context.logger.debug(`      Found comma before, adjusting removal start. New property won't need a comma.`);
          } else {
            context.logger.debug(
              `      No comma found before or after (or only one property). Using default removal range.`
            );
          }
          // If there's no comma before or after (and properties.length > 1), something is odd,
          // but the default logic of just removing the node might work.
          // If properties.length === 1, nothing is done here, just remove the node.
        }
      } else {
        context.logger.debug(`      Only one property ('template'). Simple removal.`);
      }
      // --- End of Modified Logic ---

      // Remove the old 'template' property and its associated formatting (comma/spaces)
      context.logger.debug(`    ➖ Eliminando propiedad 'template' (rango ${removalStart} - ${removalEnd})...`);
      recorder.remove(removalStart, removalEnd - removalStart);

      // Build the text to insert
      const textToInsert = `${newTemplateUrlProperty}${needsCommaInserted ? "," : ""}`;
      context.logger.debug(
        `    ➕ Insertando nueva propiedad '${textToInsert}' en la posición ${templatePropertyNode.getStart(
          sourceFile
        )}...`
      );

      // Insert the new 'templateUrl' property at the position where the original code of the removed node started
      // (using getStart() instead of getFullStart() to avoid inserting before initial comments/spaces)
      recorder.insertLeft(templatePropertyNode.getStart(sourceFile), textToInsert);

      // Apply the changes to the virtual tree
      context.logger.debug(`    💾 Aplicando cambios al archivo...`);
      tree.commitUpdate(recorder);
      context.logger.info(`  ✅ Actualizado ${filePath}: se reemplazó 'template' con 'templateUrl'.`);
    });

    context.logger.info("\n🏁 Migración de plantillas en línea completada.");
    return tree;
  };
}
