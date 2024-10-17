/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { PTouch } from "./PTouch.js";
import { fromBinary, toBinary } from "./Readable.js";

const STATUS = Buffer.from([
  0x80, 0x20, 0x42, 0x30, 0x59, 0x30, 0x00, 0x00,
  0x00, 0x00, 0x0c, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

/**
 * Layer over PTouch that overrides read and write for debug
 */
class PTouchStub extends PTouch {

  /**
   * @override
   */
  write(buff) {
    this.output.push(fromBinary(buff));
    this.debug(this.output.join("\n"));
    return Promise.resolve({ bytesWritten: buff.length });
  }

  /**
   * @override
   */
  read() {
    return Promise.resolve({ bytesRead: STATUS.length, buffer: STATUS });
  }

  initialise() {
    this.output = [];
    this.initialised = true;
    return this.getStatusReport()
    .then(sr => { console.log(sr); return sr; });
  }
}

export { PTouchStub }
