import { Rule, SchematicContext, Tree } from "@angular-devkit/schematics";
import { dirname, join, basename, normalize } from "path";
import * as ts from "typescript";

// --- Helper Functions Restored ---

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
      prop // Type guard added below
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
      prop // Type guard added below
    ): prop is ts.PropertyAssignment => // Type guard
      ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName
  );
  return property || null; // If find doesn't find it, it returns undefined, which becomes null with ||
}

// --- Main Schematic Rule ---

export function migrarTemplates(): Rule {
  return (tree: Tree, context: SchematicContext): Tree => {
    context.logger.info("🚀 Starting search for components with inline templates..."); // Translated

    try {
      // <-- Add a general try in case getDir fails
      tree.getDir("/src").visit((filePath) => {
        // *** START OF PER-FILE TRY-CATCH BLOCK ***
        try {
          // Main log for each file
          context.logger.info(`\n🔍 Analyzing file: ${filePath}`); // Translated (kept emoji)

          // Process only *.component.ts files
          if (!filePath.endsWith(".component.ts")) {
            context.logger.debug(`  ➡️ Skipping (not a .component.ts file)`); // Translated
            return;
          }
          context.logger.debug(`  ✅ It's a .component.ts file, continuing...`); // Translated

          const fileBuffer = tree.read(filePath);
          if (!fileBuffer) {
            context.logger.warn(`  ⚠️ Could not read file: ${filePath}`); // Translated
            return;
          }
          context.logger.debug(`  📄 File read successfully.`); // Translated

          const content = fileBuffer.toString("utf-8");
          const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true // setParentNodes is important for analysis
          );
          context.logger.debug(`  🌳 File parsed into TypeScript AST.`); // Translated

          // Find the @Component decorator
          context.logger.debug(`  🔎 Searching for @Component decorator...`); // Translated
          const componentDecorator = findComponentDecorator(sourceFile); // Now defined
          if (!componentDecorator) {
            context.logger.debug(`  ❌ @Component decorator not found or non-standard. Skipping.`); // Translated
            return;
          }
          context.logger.debug(`  👍 @Component decorator found.`); // Translated

          // Check if it already has templateUrl
          context.logger.debug(`  🔎 Checking if 'templateUrl' already exists...`); // Translated
          // *** FIX for TS7006: Added type ts.ObjectLiteralElementLike ***
          const hasTemplateUrl = componentDecorator.properties.some(
            (prop: ts.ObjectLiteralElementLike) =>
              ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "templateUrl"
          );

          if (hasTemplateUrl) {
            context.logger.info(`  ➡️ Skipping ${filePath}: already has 'templateUrl'.`); // Translated
            return; // Already has templateUrl, do nothing
          }
          context.logger.debug(`  👍 Does not have 'templateUrl', searching for inline 'template'...`); // Translated

          // Find the 'template' property and get its content
          const templateContent = getDecoratorPropertyValue(componentDecorator, "template"); // Now defined

          if (templateContent === undefined) {
            context.logger.info(`  ➡️ Skipping ${filePath}: inline 'template' property not found.`); // Translated
            return;
          }
          context.logger.debug(`  👍 'template' property found with content.`); // Translated

          // --- Required Actions ---
          context.logger.info(`  ✨ Processing ${filePath}: Migrating inline template to external file.`); // Translated

          // 1. Determine the path for the new HTML file
          context.logger.debug(`    📝 Determining path for the new HTML file...`); // Translated
          const componentDir = dirname(filePath);
          const componentBaseName = basename(filePath, ".ts"); // e.g., 'my-component.component'
          const htmlFileName = `${componentBaseName}.html`; // e.g., 'my-component.component.html'
          const htmlFilePath = normalize(join(componentDir, htmlFileName));
          const relativeHtmlPath = `./${htmlFileName}`; // Relative path for templateUrl
          context.logger.debug(`    📂 HTML file path: ${htmlFilePath}`); // Translated
          context.logger.debug(`    🔗 Relative path for templateUrl: ${relativeHtmlPath}`); // Translated

          // 2. Create the HTML file (if it doesn't exist)
          context.logger.debug(`    🔎 Checking if the HTML file already exists...`); // Translated
          if (tree.exists(htmlFilePath)) {
            context.logger.warn(`    ⚠️ HTML file already exists, creation will be skipped: ${htmlFilePath}`); // Translated
          } else {
            context.logger.debug(`    ➕ Creating HTML file: ${htmlFilePath}...`); // Translated
            tree.create(htmlFilePath, templateContent);
            context.logger.debug(`    ✅ HTML file created.`); // Translated
          }

          // 3. Update the .ts file
          context.logger.debug(`    🔄 Updating TypeScript file (${filePath})...`); // Translated
          const templatePropertyNode = getDecoratorPropertyNode(componentDecorator, "template"); // Now defined
          if (!templatePropertyNode) {
            context.logger.error(
              `    ❌ Critical error: Could not find the 'template' property node in ${filePath} after getting its content. Skipping update.` // Translated
            );
            return; // Skip update for this file
          }
          context.logger.debug(`    👍 'template' property node found.`); // Translated

          // Build the new templateUrl property
          const newTemplateUrlProperty = `templateUrl: '${relativeHtmlPath}'`;
          context.logger.debug(`    🔧 Building new property: ${newTemplateUrlProperty}`); // Translated

          const recorder = tree.beginUpdate(filePath);
          context.logger.debug(`    📐 Calculating range to remove 'template' property and handle commas...`); // Translated

          // --- Modified Logic for Calculating Removal Range ---
          let removalStart = templatePropertyNode.getFullStart();
          let removalEnd = templatePropertyNode.getEnd();

          // Check if there's a comma before the template property
          const textBeforeNode = sourceFile.text.substring(0, templatePropertyNode.getFullStart());
          const commaMatchBefore = textBeforeNode.match(/,\s*$/);
          
          if (commaMatchBefore) {
            // If there's a comma before, we need to keep it
            removalStart -= commaMatchBefore[0].length;
          }

          context.logger.debug(`    ➖ Removing 'template' property (range ${removalStart} - ${removalEnd})...`); // Translated
          recorder.remove(removalStart, removalEnd - removalStart);

          // Insert the new property with proper formatting
          const textToInsert = `,\n  ${newTemplateUrlProperty}`;
          context.logger.debug(
            `    ➕ Inserting new property '${textToInsert}' at position ${templatePropertyNode.getStart(
              sourceFile
            )}...` // Translated
          );

          recorder.insertLeft(templatePropertyNode.getStart(sourceFile), textToInsert);

          context.logger.debug(`    💾 Applying changes to the file...`); // Translated
          tree.commitUpdate(recorder);
          context.logger.info(`  ✅ Updated ${filePath}: replaced 'template' with 'templateUrl'.`); // Translated

          // *** START OF PER-FILE CATCH BLOCK *** // Kept English comment marker
        } catch (error) {
          context.logger.error(`💥 Error processing file ${filePath}:`); // Translated
          // Print the error message and, if available, the stack trace
          if (error instanceof Error) {
            context.logger.error(`  Message: ${error.message}`); // Translated
            if (error.stack) {
              context.logger.error(`  Stack: ${error.stack}`); // Translated
            }
          } else {
            context.logger.error(`  Error: ${String(error)}`); // Translated
          }
          // You can decide whether to continue with other files or stop everything.
          // For now, we just log and continue with the next file.
        }
        // *** END OF PER-FILE TRY-CATCH BLOCK *** // Kept English comment marker
      });
    } catch (error) {
      // <-- Catch errors from getDir or visit itself
      context.logger.fatal(`❌ Fatal error starting file traversal:`); // Translated
      if (error instanceof Error) {
        context.logger.fatal(`  Message: ${error.message}`); // Translated
        if (error.stack) {
          context.logger.fatal(`  Stack: ${error.stack}`); // Translated
        }
      } else {
        context.logger.fatal(`  Error: ${String(error)}`); // Translated
      }
      // Here you should probably stop execution
      throw error; // Rethrow the error to stop the schematic
    }

    context.logger.info("\n🏁 Inline template migration (potentially) completed."); // Translated final message
    return tree;
  };
}
