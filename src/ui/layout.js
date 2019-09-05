// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const Layout = require('./layout.js');
// const sk = require('./skeleton.js');
const assert = require('../assert.js');
const env = require('../env.js');

function editLayout(node, propName){
  let editor = document.querySelector('#layout-editor');
  assert(editor, 'Missing sub-editor for layout, prop=' + propName);
  env.openPanel('layout');

  // layout editor
  let layout = node.layout;

  // folded state
  let auto = editor.querySelector('#layout-auto');
  auto.checked = layout.auto;
  auto.onchange = function(){
    // if switching to manual, we use the auto values as initial values
    if(!auto.checked){
      layout.data = Array.from({ length: node.degree }).map((n,i) => layout.getPosition(i));
    }
    layout.auto = auto.checked;
    editLayout(node, propName); // update since everything might change
  };

  let values = Array.from({ length: node.degree }).map((n,i) => layout.getPosition(i));
  let list = document.getElementById('layout_list');
  while(list.firstChild)
    list.removeChild(list.firstChild);
  let inputs = [];
  for(let i = 0; i < layout.degree; ++i){
    let item = document.createElement('li');
    item.setAttribute('data-index', i);
    item.setAttribute('data-number', i+1);
    let input = document.createElement('input');
    input.type = 'number';
    input.min = i == 0 ? 0 : values[i-1];
    input.max = i == layout.degree-1 ? 1 : values[i+1];
    input.step = 0.01;
    input.value = values[i];
    if(layout.auto || input.degree == 1)
      input.disabled = true;
    else {
      // cannot change when automatic
      input.onchange = function(){
        layout.data[i] = parseFloat(input.value);
        // update previous' max and next's min
        if(i > 0)
          inputs[i-1].max = layout.data[i];
        if(i < inputs.length-1)
          inputs[i+1].min = layout.data[i];
        // XXX update drawing
      };
    }
    inputs.push(input);
    item.appendChild(input);
    list.appendChild(item);
  }
  if(layout.auto)
    list.classList.add('auto');

  // interface drawing

}

// export
module.exports = editLayout;
