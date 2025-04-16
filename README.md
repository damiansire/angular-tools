# Schematic: Inline Template and Styles Migration

This Angular schematic automates the process of migrating inline `template` and `styles` defined within `@Component` decorators to external `.html` and `.scss` files, respectively.

## What it Does

The schematic (`inline-template-schematic:mt`) performs the following actions in your Angular project:

1.  **Finds Components:** It traverses all `.component.ts` files within the `src/` directory.
2.  **Identifies Inline Templates:** If a component has a `template` property but no `templateUrl`:
    - Extracts the content of the `template`.
    - Creates a new `.html` file (e.g., `my-component.component.html`) in the same directory with that content.
    - Replaces the `template: '...'` property with `templateUrl: './my-component.component.html'` in the `.ts` file.
3.  **Identifies Inline Styles:** If a component has a `styles` property but no `styleUrls`:
    - Extracts the content of `styles`. This can be a single string or an array of strings.
    - For each style string, it creates a new `.scss` file (e.g., `my-component.component.scss`, `my-component-2.scss`, etc.) in the same directory with that content.
    - Replaces the `styles: [...]` property with `styleUrls: ['./my-component.component.scss', ...]` in the `.ts` file.
4.  **Comma Handling:** Attempts to automatically adjust commas when replacing properties in the decorator.
5.  **Safety:** Does not overwrite existing `.html` or `.scss` files. Logs warnings and errors to the console.

## Usage in a Project

To use this schematic in your Angular project:

1.  **Installation (If published on npm):**

    ```bash
    npm install --save-dev your-schematic-package
    # Or if it's a global or local dev dependency without a package:
    # Ensure it's accessible (see Development section)
    ```

2.  **Execution:**
    Navigate to the root of your Angular project and run:

    ```bash
    ng generate inline-template-schematic:mt
    ```

    Or the short form:

    ```bash
    ng g inline-template-schematic:mt
    ```

    The schematic will analyze your project and apply the necessary migrations. Review the generated changes before committing them.

## Schematic Development

If you are modifying or developing this schematic locally, follow these steps to test it in another Angular project:

1.  **Build the Schematic:**
    Inside the root directory of the _schematic's project_ (e.g., `angular-tools`), run the build command (ensure it's configured in your `package.json`):

    ```bash
    npm run build
    ```

    This compiles the TypeScript files to JavaScript (usually into a `dist/` directory or similar).

2.  **Create a Symbolic Link (Link):**
    From the root directory of the _schematic's project_, run:

    ```bash
    npm link
    ```

    This creates a global link on your system to your local schematic package, using the name defined in its `package.json`.

3.  **Use the Link in the Test Project:**

    - Navigate to the root directory of the _Angular project where you want to test_ the schematic.
    - Run the `npm link` command followed by the package name of your schematic (the name in the schematic's `package.json`, e.g., `inline-template-schematic` if that's the name):
      ```bash
      npm link inline-template-schematic
      ```
      (Replace `inline-template-schematic` with the actual name of your package).
      This creates a folder in the test project's `node_modules` that points directly to your local schematic source code.

4.  **Run the Local Schematic:**
    Now, inside the test project, you can run the schematic as you normally would:

    ```bash
    ng g inline-template-schematic:mt
    ```

    Angular will find and execute the linked local version of your schematic.

5.  **Unlink (Optional):**
    When you're finished testing, you can unlink the packages:
    - In the _test project_: `npm unlink inline-template-schematic` (or `npm uninstall inline-template-schematic`)
    - In the _schematic's project_: `npm unlink`

This workflow allows you to quickly test changes to your schematic without needing to publish it to npm each time.

### Unit Testing

`npm run test` will run the unit tests, using Jasmine as a runner and test framework.

### Publishing

To publish, simply do:

```bash
npm run build
npm publish
```

That's it!
