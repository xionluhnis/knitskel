// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const env = require('../env.js');
const sk = require('../skeleton.js');

let editor = null;
let lastCode = '';
let lastCodeID = -1;
let changeID = 0;
let updateInt = -1;
let listeners = {};

function registerUpdateCallback(name, callback){
  listeners[name] = callback;
}

function newOption(value, text) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = text;
  return opt;
}

function editCustom(nodeID){
  // show panel
  env.openPanel('custom');

  // options
  const target = document.getElementById('custom_target');
  while(target.firstChild)
    target.removeChild(target.firstChild);
  for(let n of env.nodes){
    if(n.category == sk.NODE_CUSTOM)
      target.appendChild(newOption(n.id, 'Code of ' + n.name + ' #' + n.id));
  }
  target.value = nodeID;
  target.onchange = function(){
    editCustom(target.value);
  };

  // editor
  if(!editor)
    initEditor();

  // disable list if invalid layer
  const node = env.nodes.find(n => n.id == nodeID);
  const disabled = !node || node.category != sk.NODE_CUSTOM;
  target.disabled = disabled;
  editor.setOption('readOnly', disabled);
  const cm = document.querySelector('#custom-editor .CodeMirror');
  cm.style.backgroundColor = disabled ? '#eee' : 'white';
  cm.title = disabled ? 'No custom node available' : '';

  // save custom to file
  let save = document.querySelector('#save_custom');
  save.onclick = function(){
    let code = editor.getValue();
    save.href = 'data:application/octet-stream,' + code;
    save.download = 'code.kcrs';
  };

  // load custom from file
  let file = document.querySelector('#file_custom');
  let load = document.querySelector('#load_custom');
  load.onclick = function(){
    if(!disabled)
      file.click();
  };
  file.onchange = function(){
    if(!disabled)
      loadCustom(file.files[0]);
  };

  // set custom
  selectCustom(nodeID);

  // update stream
  if(updateInt >= 0){
    clearInterval(updateInt);
    updateInt = -1;
  }
  if(!disabled){
    updateInt = setInterval(updateCustom, 1000);
  }

  // generateDocu();
}

function initEditor(){
  // codemirror
  editor = CodeMirror.fromTextArea(document.querySelector('#custom'), {
    lineNumbers: true, tabSize: 2, lineWrapping: true
  });
  editor.on('change', function(){
    changeID += 1;
  });
}

function selectCustom(nodeID){
  let code = '';
  const node = env.nodes.find(n => n.id == nodeID);
  if(node){
    code = node.getSourceCode();
  }
  editor.setValue(code || '');
}

function storeCustom(){
  const nodeID = document.getElementById('custom_target').value;
  const node = env.nodes.find(n => n.id == nodeID);
  if(node && node.category == sk.NODE_CUSTOM){
    node.code = editor.getValue();
    if(env.verbose)
      console.log('Storing custom program of node #' + nodeID);
  }
}

let lastBlob = null;
function loadCustom(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  let reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(data){
      editor.setValue(data);
      storeCustom();
    }
  };
  reader.readAsText(blob);
}

function updateCustom(){
  if(lastCodeID == changeID)
    return;
  let code = editor.getValue();
  if(code == lastCode)
    return;

  // cache code
  lastCode = code;
  lastCodeID = changeID;

  const nodeID = document.getElementById('custom_target').value;
  const node = env.nodes.find(n => n.id == nodeID);
  if(!node || node.category != sk.NODE_CUSTOM){
    return;
  }

  // update node
  storeCustom();

  console.log('Updating');
  let info = document.querySelector('#custom_info');
  try {
    node.eval(env.verbose, true); // unsafe evaluation to catch errors

    // no error until here
    info.classList.remove('error');
    info.textContent = 'No error';

    // trigger update
    for(let callback of Object.values(listeners)){
      callback();
    }

  } catch(err){
    info.classList.add('error');
    info.textContent = err;
  }

  // stop update when closing panel
  if(document.querySelector('#custom-editor').classList.contains('closed')){
    clearInterval(updateInt);
    updateInt = -1;
  }
}


// export
module.exports = { editCustom, registerUpdateCallback };
