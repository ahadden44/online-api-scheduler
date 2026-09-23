(function () {
  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll("script[src*='medslot.js']");
    script = scripts[scripts.length - 1] || null;
  }
  if (!script || !script.src) return;
  var origin = new URL(script.src, window.location.href).origin;
  var frame = document.createElement("iframe");
  frame.src = origin + "/embed";
  frame.title = "Schedule an appointment";
  frame.style.cssText = "width:100%;max-width:1080px;border:0;display:block;min-height:720px;background:transparent;";
  var mount = script.parentElement && script.parentElement !== document.head && script.parentElement !== document.body
    ? script.parentElement
    : null;
  if (mount && mount.childElementCount === 1 && mount.firstElementChild === script) {
    mount.appendChild(frame);
  } else {
    script.insertAdjacentElement("afterend", frame);
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== "medslot") return;
    var height = Number(data.height);
    if (height > 320 && height < 8000) frame.style.height = Math.ceil(height) + "px";
  });
})();
