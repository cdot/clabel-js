/* eslint-env browser */

import { io } from "./node_modules/socket.io/client-dist/socket.io.esm.min.js";

/* global domtoimage */

let dataUrl = "";

// Last info received from the server. This describes the printer.
let info = {
  model: "Unknown",
  pixel_width_mm: 0,
  eject_px: 0,
  eject_mm: 0,
  raster_px: 0,
  raster_mm: 0,
  printable_width_px: 0,
  printable_width_mm: 0,
  media_width_px: 0,
  media_width_mm: 0,
  phase: "Uninitialised"
};

function setInfo(n) {
  info = n;
  for (const f of Object.keys(info))
    $(`#info_${f}`).text(info[f]);
  refreshImage();
}

function refreshImage() {
  domtoimage.toPng($("#strip_div")[0])
  .then(d => {
    dataUrl = d;
    $("#strip_img")[0].src = dataUrl;
    const h = $("#strip_img").height();
    $("#label_width_px").text(h);
    $("#label_width_mm").text(h * info.pixel_width_mm);
  })
  .catch(error => {
    console.error("Rendering error", error);
    $("#strip_img")[0].src = "";
  });
}

function onLabelChanged() {
  const content = $("#label_text").val();
  $("#strip_div").html(content);
  refreshImage();
}

function setFontFamily(font) {
  const classList = $('#strip_div').attr('class').split(/\s+/);
  $.each(classList, function(index, item) {
    if (item.indexOf("font-family-") === 0) {
      $("#strip_div").removeClass(item);
    }
  });
  $("#strip_div").addClass(`font-family-${font}`);
  refreshImage();
}

function setFontSize(size) {
  $("#strip_div").css("font-size", `${size}px`);
  refreshImage();
}

function setLineHeight(size) {
  $("#strip_div").css("line-height", `${size}%`);
  refreshImage();
}

$(function() {
  $("#label_text").on("keyup", onLabelChanged);

  $("#select_font").on("change", function() {
    setFontFamily(this.value);
  });
  setFontFamily($("#select_font").val());
    
  $("#font-size").on("change", function() {
    setFontSize(this.value);
  });
  setFontSize($("#font-size").val());

  $("#line-height").on("change", function() {
    setLineHeight(this.value);
  });
  setLineHeight($("#line-height").val());

  $("#print").on("click", function() {
    $.post("/ajax/print", { png: dataUrl });
  });

  $("#eject").on("click", function() {
    $.post("/ajax/eject");
  });

  const socket = io().connect();
  socket

  // When the socket connects, ping the server for an info update
  .on("connect", () => $.get("/ajax/info"))

  // The server sent new info
  .on("INFO", info => {
    console.debug("Received INFO", info);
    setInfo(info);
  });

  onLabelChanged();
});

