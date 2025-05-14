# NuxtHub CLI

Command Line Interface for the [NuxtHub Admin](https://admin.hub.nuxt.com).

## Installation

Install the package globally:

```sh
npm install -g nuxthub
```

Or use `npx` to run the CLI without installing it:

```sh
npx nuxthub <command>
```

## Usage

```bash
USAGE nuxthub init|deploy|link|unlink|open|manage|login|logout|logs|whoami|database|ensure|enable

COMMANDS

    init      Initialize a fresh NuxtHUb project, alias of nuxi init -t hub.  
  deploy      Deploy your project to NuxtHub.                                   
 preview      Preview your project locally (using wrangler pages dev).   
    link      Link a local directory to a NuxtHub project.                      
  unlink      Unlink a local directory from a NuxtHub project.                  
    open      Open in browser the project's URL linked to the current directory.
  manage      Open in browser the NuxtHub URL for a linked project.             
   login      Authenticate with NuxtHub.                                        
  logout      Logout the current authenticated user.                            
    logs      Display the logs of a deployment.                                 
  whoami      Shows the username of the currently logged in user.
  database    Manage database migrations.               
  ensure      Ensure the NuxtHub Core module is installed and registered in the project.
  enable      Enable a specific NuxtHub feature in your project.

Use nuxthub <command> --help for more information about a command.
```

## Deploy

To deploy your project with NuxtHub, use the `nuxthub deploy` command. This will build your project and deploy it to your Cloudflare account with zero-configuration.

```bash
# Deploy to production or preview based on your current branch
nuxthub deploy

# Deploy to production
nuxthub deploy --production

# Deploy to preview
nuxthub deploy --preview
```

See [how to deploy with a GitHub action](https://hub.nuxt.com/docs/getting-started/deploy#github-action).

[https://github.com/user-attachments/assets/9d7d9206-1ee3-4f8f-a29d-8b9dd09b9913](https://github.com/user-attachments/assets/9d7d9206-1ee3-4f8f-a29d-8b9dd09b9913)

## Preview before deploy

To preview your project locally, you can use the `nuxthub preview` command. This will temporarily generate a `wrangler.toml` file and run `wrangler pages dev` to preview your project.

```bash
nuxthub preview
```

Current limitations:

- The `--remote` flag is not supported
- `hubAI()` will ask you connect within the terminal with wrangler
- `hubBrowser()` is not supported as not supported by `wrangler pages dev`

## Open in browser

To open your project in the browser, you can use the `nuxthub open` command. This will open the URL of your project in the default browser.

```bash
# Open the production or preview deployment based on your current branch
nuxthub open

# Open the production deployment
nuxthub open --production

# Open the latest preview deployment
nuxthub open --preview
```

## Open the project admin

To open your project's admin in the browser, you can use the `nuxthub manage` command. This will open the NuxtHub admin URL of your project in the default browser.

```bash
nuxthub manage
```

## Debug

To debug the CLI, you can use the `DEBUG=1` environment variable. This will print the API call made and explicit errors.

```bash
DEBUG=1 nuxthub <command>
```

## License

[Apache 2.0](./LICENSE)
