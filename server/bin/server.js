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
  "\tRun a clabel server",
  "OPTIONS",
  "\t-p, --port <file> - Port to start server on (default 9094)",
  "\t-d, --device <path> - path to printer (default /dev/usb/lp0.",
  `\t\tUse "sim" for a simulator that doesn't require a device")`,
  "\t-x - set debug (prints to console.debug)",
].join("\n");

const go_parser = new getopt.BasicParser(
  "d:(device)p:(port)x",
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
  default: console.error(DESCRIPTION); process.exit();
  case 'x': options.debug = console.debug; break;
  case 'p': options.port = option.optarg ; break;
  case 'd': options.device = option.optarg ; break;
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

