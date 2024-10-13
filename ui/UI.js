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
  for (const f of Object.keys(info)) {
    $(`.text-${f}`).text(info[f]);
    $(`.min-height-${f}`).css("min-height", `${info[f]}px`);
  }
  refreshImage();
}

/**
 * Given a Uint8Array containing 4-byte image data, trim empty rows
 * from top and bottom.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 * @return {object.<above, below>} number of rows above and below the
 * image to be trimmed
 */
function trim(data, w, h) {

  function keep(offset) {
    return data[offset] > 0
    || data[offset + 1] > 0
    || data[offset + 2] > 0
    || data[offset + 3] > 0;
  }

  // crop the image from the top down
  let cropping = true;
  let above, crop = true;
  for (above = 0; crop && above < h; above++) {
    for (let x = 0; x < w; x++) {
      if (keep((above * w + x) * 4)) {
        crop = false;
        break;
      }
    }
  }

  let below = 0;
  if (above >= h)
    // still cropping when we reached the top of the image
    above = 0;
  else {
    // Found at least one uncroppable row, crop up from the bottom
    crop = true;
    for (below = 0; crop && h - below > above; below++) {
      for (let x = 0; x < w; x++) {
        if (keep(((h - 1 - below) * w + x) * 4)) {
          crop = false;
          break;
        }
      }
    }
    if (below > 0) below--;
  }
  return { above, below };
}

function refreshImage() {
  domtoimage
  // Get a Uint8Array with every 4 elements representing the RGBA data
  .toPixelData($("#review_div")[0])
  .then(data => {
    // Construct an ImageData object from the pixel data
    const node = $("#review_div")[0];
    const w = node.scrollWidth;
    const h = node.scrollHeight;
    const { above, below } = trim(data, w, h);

    // render the cropped area to an ImageBitmap
    const imageData = new ImageData(data, w, h);
    return window.createImageBitmap(
      imageData, 0, above, w, h - above - below);
  })
  .then(imageBitmap => {
    // Render the cropped image onto the canvas
    const canvas = $("#image_canvas")[0];
    const w = canvas.width = imageBitmap.width;
    const h = canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    $("#image_liner").height(h);

    $("#label_length_px").text(w);
    $("#label_length_mm").text(w * info.pixel_width_mm);
    $("#label_width_px").text(h);
    $("#label_width_mm").text(h * info.pixel_width_mm);
    if (h > info.printable_width_px) {
      $("#tape_div")
      .css("top", 0)
      .css("left", "0")
      .css("height", `${info.printable_width_px}px`)
      .show();
    } else
      $("#tape_div").hide();
  })
  .catch(error => {
    console.error("Rendering error", error);
  });
}

function onLabelChanged() {
  const content = $("#label_text").val();
  $("#review_div").html(content);
  refreshImage();
}

function setFontFamily(font) {
  const classList = $('#review_div').attr('class').split(/\s+/);
  $.each(classList, function(index, item) {
    if (item.indexOf("font-family-") === 0) {
      $("#review_div").removeClass(item);
    }
  });
  $("#review_div").addClass(`font-family-${font}`);
  refreshImage();
}

function setFontSize(size) {
  $("#review_div").css("font-size", `${size}px`);
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

  $("#print").on("click", function() {
    $.post("/ajax/print", { png: dataUrl });
  });

  $("#eject").on("click", function() {
    $.post("/ajax/eject");
  });

  $.get("/ajax/info", info => {
    console.debug("Received INFO", info);
    setInfo(info);
  });

  onLabelChanged();
});

