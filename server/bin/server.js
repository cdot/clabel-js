/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
import Path from "path";
const __dirname = Path.dirname(__filename);
const docRoot = Path.normalize(Path.join(__dirname, "..", "..", "ui"));

import getopt from "posix-getopt";

import { Server } from "../src/Server.js";

const DESCRIPTION = [
  "USAGE",
  `\tnode ${Path.relative(".", process.argv[1])} [options]`,
  "DESCRIPTION",
  "\tRun a label print server for a Brother label printer",
  "OPTIONS",
  "\t-p, --port <file> - Port to start server on (default 9094)",
  "\t-d, --device <path> - path to printer (default /dev/usb/lp0.",
  "\t-t, --type <type> - Set the printer type e.g. -t PT1230. If the",
  "\t\ttype ends with _F then the device is assumed to be write-only",
  "\t\te.g. a simple file",
  "\t\tIf the --type is not set, the --device will be interrogated.",
  "\t-h, --help - output this information",
  "\t-x - set debug (prints to console.debug)"
].join("\n");

const go_parser = new getopt.BasicParser(
  "d:(device)p:(port)t:(type)xh",
  process.argv);

const options = {
  port: 9094,
  docRoot: docRoot,
  device: "/dev/usb/lp0",
  debug: () => {}
};

let option;
while ((option = go_parser.getopt())) {
  switch (option.option) {
  default: console.error(`*** Unknown option -${option.option}\n${DESCRIPTION}`); process.exit();
  case 't': options.model = option.optarg; break;
  case 'x': options.debug = console.debug; break;
  case 'p': options.port = option.optarg ; break;
  case 'd': options.device = option.optarg ; break;
  case 'h': console.log(DESCRIPTION); process.exit();
  }
}
if (process.argv.length > go_parser.optind()) {
  console.error(`*** Unexpected "${process.argv[go_parser.optind()]}"`);
  console.error(DESCRIPTION);
  process.exit();
}

console.debug(
  `Starting server for device ${options.device}`,
  `on port ${options.port}`);

const server = new Server(options);
server.listen(options.port);

