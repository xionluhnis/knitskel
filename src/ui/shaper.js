// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const assert = require('../assert.js');
const Shaper = require('../shaper.js');
const env = require('../env.js');

// constants
const width  = 600;
const height = 200;

let update = function(){};
let editor = null;
function editShaper(node, propName){
  let panel = document.getElementById('shaper-editor');
  assert(panel, 'Missing sub-editor for shaper, prop=' + propName);
  env.openPanel('shaper');

  // init editor
  if(!editor)
    initEditor();

  // register update function
  update = () => {
    updateShaper(node, propName);
  };

  // predefined shaper list
  let select = panel.querySelector('select');
  while(select.firstChild)
    select.removeChild(select.firstChild);
  for(let name in Shaper.predefined){
    let option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  let shaper = node[propName];
  if(shaper in Shaper.predefined){
    select.value = shaper;
  }
  select.onchange = function(){
    node[propName] = select.value;
    editShaper(node, propName);
  };

  // manual selection
  let manual = document.getElementById('shaper_manual');
  select.disabled = !!manual.checked;
  manual.onclick = function(){
    if(!manual.checked)
      node[propName] = 'left';
    editShaper(node, propName);
  };
  let editorTag = panel.querySelector('.CodeMirror');
  if(editorTag)
    editorTag.style.display = manual.checked ? 'block' : 'none';

  // update display
  updateShaper();
}

function initEditor(){
  // codemirror
  editor = CodeMirror.fromTextArea(document.getElementById('user_shaper'), {
    lineNumbers: true, tabSize: 2, lineWrapping: true
  });
  editor.on('change', function(){
    updateShaper();
  });
}

function updateShaper(node, propName){
  let manual = document.getElementById('shaper_manual').checked;
  let shaper;
  if(manual){
    shaper = editor.getValue();
  } else {
    shaper = document.getElementById('shaper_name').value || 'left';
  }
  if(node && propName){
    node[propName] = shaper;
  }

  // information
  let info = document.getElementById('shaper_info');

  // display parameters
  let M = document.getElementById('M');
  let N = document.getElementById('N');
  M.onchange = function(){
    N.min = M.value;
    updateShaper();
  };
  N.onchange = function(){
    M.max = N.value;
    updateShaper();
  };

  // get test mapping
  let m = parseInt(M.value);
  let n = parseInt(N.value);
  let mapping = null;
  try {
    mapping = Shaper.test(shaper, m, n);
    // feedback
    info.classList.remove('error');
    info.textContent = 'Compiled correctly';

  } catch(e){

    info.classList.add('error');
    info.textContent = 'Error: ' + e.message;
    return;
  }

  // display result
  let canvas = document.getElementById('shaper_output');
  canvas.width = width;
  canvas.height = height;
  let ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  // draw links
  let top = height / 3;
  let bot = 2 * top;
  let radius = Math.min(width/n/3, Math.min(height/4, 10));
  let topPos = [];
  for(let i = 0; i < n; ++i)
    topPos.push((i+1) * width / (n + 1));
  let botPos = [];
  for(let i = 0; i < m; ++i)
    botPos.push((i+1) * width / (m + 1));
  for(let j = 0; j < mapping.length; ++j){
    let sources = mapping[j];
    if(!sources)
      continue;
    for(let i of sources){
      ctx.beginPath();
      ctx.strokeStyle = 'gray';
      ctx.moveTo(botPos[i], bot);
      ctx.lineTo(topPos[j], top);
      ctx.stroke();
    }
  }
  // draw sources and targets
  for(let i = 0; i < m; ++i){
    ctx.beginPath();
    ctx.arc(botPos[i], bot, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = '#09F';
    ctx.fill();
  }
  for(let i = 0; i < n; ++i){
    ctx.beginPath();
    ctx.arc(topPos[i], top, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = '#0A0';
    ctx.fill();
  }
}

// export
module.exports = editShaper;
