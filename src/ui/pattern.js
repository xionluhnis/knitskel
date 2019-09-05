// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const noise = require('simplenoise');
const Pattern = require('../pattern.js');
const env = require('../env.js');

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

function editPattern(nodeID, layerNum){
  // show panel
  env.openPanel('pattern');

  // options
  const target = document.querySelector('#pattern_target');
  while(target.firstChild)
    target.removeChild(target.firstChild);
  target.appendChild(newOption('before', 'Initial pattern'));
  for(let n of env.nodes){
    const pattern = n.pattern;
    for(let l = 0; l < pattern.layers.length; ++l){
      target.appendChild(newOption([n.id, l].join('/'), 'Layer ' + l + ' of ' + n.name + ' #' + n.id));
    }
  }
  target.appendChild(newOption('after', 'Final pattern'));
  if(typeof nodeID == 'string')
    target.value = nodeID;
  else
    target.value = [nodeID, layerNum === undefined ? 0 : layerNum].join('/');
  target.onchange = function(){
    if(target.value.includes('/')){
      const ids = target.value.split('/').map(str => parseInt(str));
      editPattern(ids[0], ids[1]);
    } else {
      editPattern(target.value);
    }
  };

  // editor
  if(!editor)
    initEditor();
  
  // pattern list
  let list = document.querySelector('#pattern_list');
  while(list.firstChild)
    list.removeChild(list.firstChild);
  list.appendChild(newOption('', '--- select ---'));
  list.appendChild(newOption('// rib 1x1\npat.filter(n => n.waleId % 2 == 1).purl()', 'Rib 1x1'));
  list.appendChild(newOption('// rib 1x2\npat.filter(n => n.waleId % 3 < 1).purl()', 'Rib 1x2'));
  list.appendChild(newOption('// rib 2x1\npat.filter(n => n.waleId % 3 < 2).purl()', 'Rib 2x1'));
  list.appendChild(newOption('// rib 2x2\npat.filter(n => n.waleId % 4 < 2).purl()', 'Rib 2x2'));
  // XXX extend library of already-made patterns here

  // disable list if invalid layer
  let disabled = false;
  if(typeof nodeID == 'number'){
    const node = env.nodes.find(n => n.id == nodeID);
    if(!node){
      disabled = true;
    } else {
      const layer = node.pattern.layers[layerNum];
      if(!layer || layer.type >= 0){
        disabled = true;
      }
    }
  }
  list.disabled = disabled;
  editor.setOption('readOnly', disabled);
  const cm = document.querySelector('#pattern-editor .CodeMirror');
  cm.style.backgroundColor = disabled ? '#eee' : 'white';
  cm.title = disabled ? 'Read-only drawing layer' : '';

  // append code to editor when selected
  list.onchange = function(){
    let code = list.value;
    let edit = editor.getValue();
    if(code.length){
      editor.setValue(edit.length ? code + '\n' + edit : code);
      ++changeID;
    }
    // revert to "--- select ---"
    setTimeout(() => {
      list.value = '';
    }, 1000);
  };

  // save pattern to file
  let save = document.querySelector('#save_pattern');
  save.onclick = function(){
    let code = editor.getValue();
    save.href = 'data:application/octet-stream,' + code;
    save.download = 'pattern.pat';
  };

  // load pattern from file
  let file = document.querySelector('#file_pattern');
  let load = document.querySelector('#load_pattern');
  load.onclick = function(){
    if(!disabled)
      file.click();
  };
  file.onchange = function(){
    if(!disabled)
      loadPattern(file.files[0]);
  };

  // set pattern
  selectPattern(nodeID, layerNum);

  // update stream
  if(updateInt >= 0){
    clearInterval(updateInt);
    updateInt = -1;
  }
  if(!disabled){
    updateInt = setInterval(updatePattern, 1000);
  }

  generateDocu();
}

function initEditor(){
  // codemirror
  editor = CodeMirror.fromTextArea(document.querySelector('#pattern'), {
    lineNumbers: true, tabSize: 2, lineWrapping: true
  });
  editor.on('change', function(){
    changeID += 1;
  });
}

function selectPattern(nodeID, layerNum){
  let code = '';
  if(typeof nodeID == 'string'){
    code = env.global[nodeID + 'Pattern'];
  } else {
    const node = env.nodes.find(n => n.id == nodeID);
    if(node){
      const pattern = node.pattern;
      const layer = pattern.layers[layerNum];
      if(layer)
        code = layer.toString();
    }
  }
  editor.setValue(code || '');
}

function storePattern(){
  let nodeID, layerNum;
  let value = document.getElementById('pattern_target').value;
  if(value.includes('/')){
    [nodeID, layerNum] = value.split('/').map(str => parseInt(str));
    const node = env.nodes.find(n => n.id == nodeID);
    if(node){
      const layer = node.pattern.layers[layerNum];
      if(layer && layer.type == -1){
        layer.updateFromString(editor.getValue());
        if(env.verbose)
          console.log('Storing program pattern of node #' + nodeID + ' / layer ' + layerNum);
      }
    }
  } else {
    nodeID = value;
    env.global[nodeID + 'Pattern'] = editor.getValue();
    if(env.verbose)
      console.log('Storing global pattern', nodeID);
  }
}

let lastBlob = null;
function loadPattern(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  let reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(data){
      editor.setValue(data);
      storePattern();
    }
  };
  reader.readAsText(blob);
}

function updatePattern(){
  if(lastCodeID == changeID)
    return;
  let code = editor.getValue();
  if(code == lastCode)
    return;

  // cache code
  lastCode = code;
  lastCodeID = changeID;

  // update node
  storePattern();

  console.log('Updating');
  let info = document.querySelector('#pattern_info');
  try {
    // try to compile
    Pattern.compile(code);

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
  if(document.querySelector('#pattern-editor').classList.contains('closed')){
    clearInterval(updateInt);
    updateInt = -1;
  }
}

function generateDocu(){
  // generate documentation
  let docu = document.querySelector('#pattern_docu');
  // properties of nodes
  let nodeProps = ['id', 'shapes', 'flat', 'siblings', 'links', 'names', 'courseId', 'courseEnd', 'waleId', 'waleEnd', 'gauge'];
  // documentation object
  let objects = {
    'n': nodeProps,
    'pat': Pattern.prototype,
    // 'kn.*': KnitSelection.prototype,
    'noise': noise,
    'math': {}
  };
  // Math is not enumerable
  ['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'ceil', 'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor', 'fround', 'hypot', 'imul', 'log', 'log10', 'log1p', 'log2', 'max', 'min', 'pow', 'random', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'].forEach(function(funName){
    objects.math[funName] = Math[funName];
  });
  ['E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'PI', 'SQRT1_2', 'SQRT2'].forEach(function(constName){
    objects.math[constName] = Math[constName];
  });

  // extra help
  let helpText = {
    'n': 'node properties',
    'pat': 'chainable pattern methods',
    'noise': 'pseudo-random noise',
    'math': 'math functions'
  };

  // documentation
  let docSource = '';
  for(let name in objects){
    let o = objects[name];
    let areProps = o == nodeProps;
    docSource += '<li><strong>' + name + '</strong> (' + helpText[name] + ')<ul>';
    for(let prop in o){
      let type;
      if(areProps){
        type = 'prop';
        prop = o[prop];
      } else if(typeof(o[prop]) == 'function')
        type = 'fun';
      else
        type = 'const';
      docSource += '<li class="' + type + '"><code>';
      docSource += type;
      docSource += ' ' + name + '.<strong>' + prop + '</strong>';
      if(type == 'fun')
        docSource += '(' + ('xyzabcdef'.slice(0, o[prop].length).split('').join(',')) + ')';
      docSource += '</code></li>';
    }
    docSource += '</ul></li>';
  }
  docu.innerHTML = docSource;

}

// export
module.exports = { editPattern, registerUpdateCallback };
