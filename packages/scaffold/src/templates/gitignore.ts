import { dedent } from 'ts-dedent'


export function gitignoreTemplate(): string {
  return dedent`
    # Git ignore

    .astro/
    .cache/
    .wrangler/
    .temp/
    .tmp/
    .clangd/
    .expo/

    # dependencies
    node_modules/

    # credentials
    credentials.json
    credentials/
    *.keystore
    *.jks

    # dotenv
    .dev.vars
    .env
    .env.*
    !.env.example

    # IDE
    .devcontainer/
    .idea/
    .vscode/
    .zed/

    # logs and reports
    *.log
    logs
    npm-debug.*
    report.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json

    # output
    build/
    dist/
    .output/
    out/
    temp/

    # cache
    .npm
    .pnpm-store/
    .*cache
    *.tsbuildinfo

    # macOS
    .DS_Store
    Thumbs.db

    # Playwright
    .auth
    coverage/
    playwright-report/
    test-results/

    # etc
    *.key
    *.mobileprovision
    *.orig.*
    *.p12
    *.p8
    **/*app*/*-*-*.json
  `
}
