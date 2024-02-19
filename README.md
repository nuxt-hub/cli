# NuxtHub CLI

Interface with the [NuxtHub](https://hub.nuxt.com) platform from the command line.

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
USAGE nuxthub deploy|link|unlink|open|login|logout|whoami

COMMANDS

  deploy    Deploy your project to NuxtHub.                                 
    link    Link a local directory to a NuxtHub project.                    
  unlink    Unlink a local directory from a NuxtHub project.                
    open    Open in browser the project URL linked to the current directory.
   login    Authenticate with NuxtHub.                                       
  logout    Logout the current authenticated user.                          
  whoami    Shows the username of the currently logged in user.             

Use nuxthub <command> --help for more information about a command.
```

## License

[Apache 2.0](./LICENSE)
