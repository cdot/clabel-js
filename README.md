# clabel-js
Client-server support for a Brother P-Touch 1230PC label printer.

Run the server on the machine where the printer is connected with:

node server/server.js <port> <device>

e.g.

node server/server.js 32765 /dev/usb/lp0

This will start the server on port 32765, and connect to the printer
/dev/usb/lp0.

Load the UI in a browser using localhost:32765

Labels are laid out using HTML, and can be reviewed before printing.

