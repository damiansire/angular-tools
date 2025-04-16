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
    context.logger.info("Searching for components with inline templates...");

    tree.getDir("/").visit((filePath) => {
      context.logger.info(`Reviewing ${filePath}`);
      // Process only *.component.ts files
      if (!filePath.endsWith(".component.ts")) {
        return;
      }

      const fileBuffer = tree.read(filePath);
      if (!fileBuffer) {
        context.logger.warn(`Could not read file: ${filePath}`);
        return;
      }

      const content = fileBuffer.toString("utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true // setParentNodes is important for analysis
      );

      // Find the @Component decorator
      const componentDecorator = findComponentDecorator(sourceFile);
      if (!componentDecorator) {
        // Not a standard Angular component or has no decorator, skip
        return;
      }

      // Check if it already has templateUrl
      const hasTemplateUrl = componentDecorator.properties.some(
        (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "templateUrl"
      );

      if (hasTemplateUrl) {
        context.logger.debug(`Skipping ${filePath}: already has templateUrl.`);
        return; // Already has templateUrl, do nothing
      }

      // Find the 'template' property and get its content
      const templateContent = getDecoratorPropertyValue(componentDecorator, "template");

      if (templateContent === undefined) {
        // Has neither 'templateUrl' nor 'template', skip
        context.logger.debug(`Skipping ${filePath}: inline template not found.`);
        return;
      }

      // --- Required Actions ---
      context.logger.info(`Processing ${filePath}: migrating inline template.`);

      // 1. Determine the path for the new HTML file
      const componentDir = dirname(filePath);
      const componentBaseName = basename(filePath, ".ts"); // e.g., 'my-component.component'
      const htmlFileName = `${componentBaseName}.html`; // e.g., 'my-component.component.html'
      const htmlFilePath = normalize(join(componentDir, htmlFileName));
      const relativeHtmlPath = `./${htmlFileName}`; // Relative path for templateUrl

      // 2. Create the HTML file (if it doesn't exist)
      if (tree.exists(htmlFilePath)) {
        context.logger.warn(`HTML file already exists, creation will be skipped: ${htmlFilePath}`);
        // You could decide to overwrite or stop here. Skipping is safer.
        // If you wanted to overwrite: tree.overwrite(htmlFilePath, templateContent);
      } else {
        tree.create(htmlFilePath, templateContent);
        context.logger.debug(`Created ${htmlFilePath}`);
      }

      // 3. Update the .ts file
      const templatePropertyNode = getDecoratorPropertyNode(componentDecorator, "template");
      if (!templatePropertyNode) {
        // This shouldn't happen if templateContent was found, but it's a good check
        context.logger.error(
          `Critical error: Could not find the 'template' property node in ${filePath} after getting its content.`
        );
        return; // Skip update for this file
      }

      // Build the new templateUrl property
      const newTemplateUrlProperty = `templateUrl: '${relativeHtmlPath}'`;

      const recorder = tree.beginUpdate(filePath);
      const properties = componentDecorator.properties;
      // const templatePropertyIndex = properties.indexOf(templatePropertyNode); // <- Removed

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
          }
          // If there's no comma before or after (and properties.length > 1), something is odd,
          // but the default logic of just removing the node might work.
          // If properties.length === 1, nothing is done here, just remove the node.
        }
      }
      // --- End of Modified Logic ---

      // Remove the old 'template' property and its associated formatting (comma/spaces)
      recorder.remove(removalStart, removalEnd - removalStart);

      // Build the text to insert
      const textToInsert = `${newTemplateUrlProperty}${needsCommaInserted ? "," : ""}`;

      // Insert the new 'templateUrl' property at the position where the original code of the removed node started
      // (using getStart() instead of getFullStart() to avoid inserting before initial comments/spaces)
      recorder.insertLeft(templatePropertyNode.getStart(sourceFile), textToInsert);

      // Apply the changes to the virtual tree
      tree.commitUpdate(recorder);
      context.logger.info(`Updated ${filePath}: replaced 'template' with 'templateUrl'.`);
    });

    context.logger.info("Inline template migration completed.");
    return tree;
  };
}
