/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */
/* global Buffer*/
/* global process */

import Path from "path";
import Cors from "cors";
import Express from "express";
import { Server as SocketServer } from "socket.io";
import HTTP from "http";
// Using Sharp for image processing
import Sharp from "sharp";

import { PTouch } from "./PTouch.js";
import { PTouchStatus } from "./PTouchStatus.js";

// Header for a base64 encoded PNG datUrl
const PNGhead = "data:image/png;base64,";

/**
 * A server for printing labels on a PTouch label printer.
 * Routes:
 * - GET /<doc> - serve a static document
 * - GET /ajax/status - get printer status (returns a PTouchStatus)
 * - POST /ajax/print - print an image sent in a PNG dataurl,
 * - POST /ajax/eject?px=<px> - eject the tape so it can be cut
 */
class Server {

  /**
   * Handle an incoming print request. The image to be printed is assumed
   * to have the long edge along the X-axis. It can be wider than the tape
   * width, in which case it will be broken up into tape runs.
   * @private
   */
  POST_print(req, res) {
    // Reconstruct a Buffer from the dataUrl
    const buff = Buffer.from(
      req.body.png.substr(PNGhead.length), 'base64');
    const sim = new Sharp(buff);
    sim
    .rotate(90)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) =>
      this.printer.printImage(data, info.width, info.height, info.channels))
    .then(() => res.status(200).send("Printed"));
  }

  /**
   * Handle a request for the current printer status.
   * @private
   */
  GET_status(req, res) {
    res.status(200).send(this.printer.status);
  }

  /**
   * Eject the tape from the printer
   * @private
   */
  POST_eject(req, res) {
    const px = req.query.px;
    this.printer.eject(parseInt(px))
    .then(() => res.status(200).send(`Ejected ${px} rasters!`));
  }

  /**
   * @param {object} params
   * @param {Model?} params.model printer model, required if write_only
   * @param {string} params.device device name (e.g. /dev/usb/lp0) 
   * @param {boolean?} params.write_only disable bidirectional comms
   * @param {function?} params.debug debug print function
   */
  constructor(params = {}) {

    /* c8 ignore next */
    this.debug = params.debug ?? function() {};

    /**
     * The printer
     * @member {PTouch}
     * @private
     */
    this.printer = new PTouch(params);

    /* c8 ignore start */
    process.on("unhandledRejection", reason => {
      // Our Express handlers may have long promise chains, and we
      // want to be able to abort those chains cleanly on a handled
      // error. To do this we can `throw` an `Error` that has
      // `isHandled` set. That error will cause an unhandledRejection,
      // but that's OK, we can just ignore it.
      if (reason && reason.isHandled)
        return;

      console.error("unhandledRejection", reason, reason ? reason.stack : "");
    });
    /* c8 ignore stop */

    /**
     * Express server
     * @member {Express}
     * @private
     */
    this.express = new Express();
    this.express.use(Cors());

    // Parse incoming requests with url-encoded payloads
    this.express.use(Express.urlencoded({ extended: true }));

    // Parse incoming requests with a JSON body
    this.express.use(Express.json());

    // Grab all static files relative to the project root
    // html, images, css etc.
    /* c8 ignore next */
    this.debug(`static files from ${params.docRoot}`);
    this.express.use(Express.static(params.docRoot));

    const cmdRouter = Express.Router();

    // 
    cmdRouter.get(
      "/",
      (req, res) => res.sendFile(
        Path.join(params.docRoot, "UI.html"),
        err => {
          if (err)
            console.error(err, "\n*** Failed to load html ***");
        }
      ));

    cmdRouter.post(
      "/ajax/print",
      (req, res) => this.POST_print(req, res));

    cmdRouter.get(
      "/ajax/status",
      (req, res) => this.GET_status(req, res));

    cmdRouter.post(
      "/ajax/eject",
      (req, res) => this.POST_eject(req, res));

    this.express.use(cmdRouter);
  }

  /**
   * Start the server, listening on the given port
   * @param {number} port number
   * @param {string} host host name
   */
  listen(port = 9094, host = "localhost") {
    // Don't start the server until the printer has successfully been
    // initialised
    this.debug("Initialising printer");
    this.printer.initialise()
    .then(() => {
      console.log("Status", PTouchStatus.Phase[this.printer.status.phase]);
      // Could also use HTTPS, but why bother?
      const protocol = HTTP.Server(this.express);
      const io = new SocketServer(protocol);
      // broadcast phase changes to all listeners
      this.printer.on(PTouchStatus.UPDATE_EVENT,
                      state => {
                        console.log(PTouchStatus.Phase[state.phase]);
                        io.emit(PTouchStatus.UPDATE_EVENT, state);
                      });
      protocol.listen(port, host);
    });
  }
}

export { Server }
