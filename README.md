# TERMOS

TERMOS is a browser-based, terminal-oriented virtual OS written with HTML, CSS and JavaScript.

## Live

GitHub Pages:

https://maitononaka.github.io/Termos/

## Repository layout

The OS itself stays in the repository root:

```text
Termos/
├── index.html
├── style.css
├── app.js
├── README.md
└── packages/
    ├── index.json
    └── example/
        ├── manifest.json
        ├── index.html
        ├── style.css
        └── app.js
```

GitHub Pages can publish files from an existing repository and preserves the directory structure of the publishing source. This makes the `packages/` directory usable as a simple static package repository.

## Package manager

TERMOS includes a `pkg` command.

Example:

```text
pkg repo set https://maitononaka.github.io/Termos/packages/
pkg update
pkg search
pkg install example
pkg list
pkg run example
pkg remove example
```

The repository index is:

```text
https://maitononaka.github.io/Termos/packages/index.json
```

## Creating a package

A package contains a `manifest.json` and its application files.

Example:

```text
packages/
└── myapp/
    ├── manifest.json
    ├── index.html
    ├── style.css
    └── app.js
```

Example `manifest.json`:

```json
{
  "name": "myapp",
  "version": "1.0.0",
  "description": "My TERMOS application",
  "entry": "index.html",
  "files": [
    "manifest.json",
    "index.html",
    "style.css",
    "app.js"
  ]
}
```

Then add the package to `packages/index.json`.

## Important

TERMOS packages are browser applications. They run inside the TERMOS virtual environment and do not become native Linux/Windows programs.

Do not put passwords, API keys, private tokens, or other secrets into a package repository because GitHub Pages content is publicly accessible.

## License

See the repository for the current project license.
