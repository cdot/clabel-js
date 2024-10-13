# clabel-js
Support for a Brother P-Touch 1230PC label printer, with a user-friendly UI that lets you design complex labels (if you speak HTML).

Uses a client-server model to take advantage of features of the browser, and of node.js.

# Usage
Run the server on the machine where the printer is connected with:
```
node server/bin/server.js
```
Run it without parameters for help.

Load the UI in a browser using `localhost:9094`.

Labels are laid out using HTML. Images are automatically converted to black and white for printing.
