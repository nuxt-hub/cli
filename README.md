# NuxtHub CLI

Interface with the [NuxtHub Console](https://console.hub.nuxt.com) platform from the command line.

## Installation

Install the package globally:

```sh
npm install -g nuxthub
```

Or use `npx` to run the CLI without installing it:

```sh
npx nuxthub
```

## Usage

```bash
USAGE nuxthub deploy|link|unlink|open|manage|login|logout|whoami

COMMANDS

  deploy    Deploy your project to NuxtHub.                                   
    link    Link a local directory to a NuxtHub project.                      
  unlink    Unlink a local directory from a NuxtHub project.                  
    open    Open in browser the project's URL linked to the current directory.
  manage    Open in browser the NuxtHub URL for a linked project.             
   login    Authenticate with NuxtHub.                                        
  logout    Logout the current authenticated user.                            
  whoami    Shows the username of the currently logged in user.
```

## License

[Apache 2.0](./LICENSE)
