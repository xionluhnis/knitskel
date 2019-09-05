// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const editFunction = require('./function.js');
const editLayout   = require('./layout.js');
const { editPattern }  = require('./pattern.js');
const editShaper   = require('./shaper.js');
const sk   = require('../skeleton.js');
const env  = require('../env.js');

const STR_PARAM = 0;
const INT_PARAM = 1;
const NUM_PARAM = 2;
const ANG_PARAM = 3;
const RNG_PARAM = 4;
const FUN_PARAM = 5;
const ENU_PARAM = 6;
const LOG_PARAM = 7;
const SHA_PARAM = 8;
const LAY_PARAM = 10;
const ITF_PARAM = 11;
const ANC_PARAM = 12; // jshint ignore:line
const PAR_PARAM = 13;
const PAT_PARAM = 14;

let parameterDescription = [
  { key: 'id',       type: INT_PARAM, params: ['disabled'] },
  { key: 'name',     type: STR_PARAM },
  // { key: 'category', type: ENU_PARAM, values: [sk.NODE_SHEET, sk.NODE_JOINT, sk.NODE_SPLIT, sk.NODE_ANCHOR, sk.NODE_INTERFACE] },
  // type: STR_PARAM, params: ['disabled'] },
  { match: 'category', values: {
    sheet: [
      { key: 'type',      type: ENU_PARAM, values: [sk.CYLINDER, sk.FLAT] },
      { key: 'length',    type: INT_PARAM },
      { key: 'width',     type: FUN_PARAM },
      { key: 'shaper',    type: SHA_PARAM },
      { key: 'alignment', type: ENU_PARAM, values: [sk.ALIGN_CENTER, sk.ALIGN_LEFT, sk.ALIGN_RIGHT] }
      // { key: 'anchors', type: ANC_PARAM }
    ],
    joint: [
      // { key: 'degree',    type: INT_PARAM, params: [ {key: 'min', value: 1} ] },
      { key: 'rows',      type: INT_PARAM, params: [{ key: 'min', value: 1 }] },
      { key: 'width',     type: FUN_PARAM },
      { key: 'linking',   type: INT_PARAM, params: [{ key: 'min', value: 1 }] },
      { key: 'alignment', type: ENU_PARAM, values: [
        sk.ALIGN_LEFT, sk.ALIGN_CENTER, sk.ALIGN_RIGHT
      ]},
      //{ cond: 'degree', greater_than: 1, then: [
      { key: 'layout',  type: LAY_PARAM }
      //]}
    ],
    split: [
      { key: 'folded',    type: LOG_PARAM },
      { key: 'degree',    type: INT_PARAM, params: [ {key: 'min', value: 1} ] },
      { key: 'alignment', type: ENU_PARAM, values: [
        sk.ALIGN_UNIFORM, sk.ALIGN_LEFT, sk.ALIGN_RIGHT, sk.ALIGN_MANUAL
      ]},
      { cond: 'alignment', equals: sk.ALIGN_MANUAL, then: [
        { key: 'layout',    type: LAY_PARAM }
      ]}
    ],
    anchor: [
      { key: 'parent',    type: PAR_PARAM, params: [ 'disabled' ] },
      { key: 'type',      type: ENU_PARAM, values: [
        sk.ANCHOR_POINT, sk.ANCHOR_SLIT, sk.ANCHOR_CIRCLE //, sk.ANCHOR_POLYGON
      ]},
      { key: 'rotation',  type: ANG_PARAM },
      { key: 'location',  type: RNG_PARAM },
      { cond: 'type', equals: sk.ANCHOR_CIRCLE, then: [
        { key: 'ratio',   type: NUM_PARAM }
      ]}
    ],
    'interface': [
      { key: 'sides/0/node/id', type: INT_PARAM, params: [ 'disabled' ] },
      { key: 'sides/0/path',    type: STR_PARAM, params: [ 'disabled' ] },
      { key: 'sides/1/node/id', type: INT_PARAM, params: [ 'disabled' ] },
      { key: 'sides/1/path',    type: STR_PARAM, params: [ 'disabled' ] }
    ]
  }},
  { cond: 'category', not: sk.NODE_INTERFACE, then: [
    { block: 'interfaces', values: [
      { fun: n => n.getInterfaces().map(itf => {
        return { key: itf.thisSide(n).path, type: ITF_PARAM };
      })}
    ]}
  ]},
  { cond: 'category', is_in: [sk.NODE_SHEET, sk.NODE_JOINT], then: [
    { block: 'knitting', values: [
      { key: 'gauge',   type: ENU_PARAM, values: [ 'full', 'half' ] },
      { key: 'pattern', type: PAT_PARAM },
      { key: 'numbering', type: ENU_PARAM, values: [ sk.PATTERN_AUTO, sk.PATTERN_UPWARD, sk.PATTERN_DOWNWARD ], label: 'number.' }
    ]}
  ]},
  { block: 'bed_layout', values: [
    // { key: 'distPower',   type: ENU_PARAM, values: [ 1, 2 ] },
    // { key: 'bedDist',     type: NUM_PARAM },
    // { key: 'bedSymmetry', type: NUM_PARAM, label: 'symmetry' },
    // { key: 'propSymmetry',type: LOG_PARAM, label: 'weighted' },
    // { key: 'flip',        type: LOG_PARAM, label: 'flippable' },
    { key: 'expansion',  type: NUM_PARAM, label: 'expand' },
    { key: 'increase',   type: ENU_PARAM, values: [ sk.INCREASE_AUTO, sk.INCREASE_SPLIT, sk.INCREASE_KICKBACK ] }
  ]},
  { cond: 'category', is_in: [sk.NODE_JOINT, sk.NODE_SPLIT], then: [
    { block: 'manual', values: [
      { key: 'flat',     type: ENU_PARAM, values: [ null, true, false ] }
    ]}
  ]},
];

let lastFocus = null;
let interfaces = [];
let currentNode = null;

function selectNode(node, renderCallback){
  // for debug
  if(!renderCallback){
    // assert(false, 'Needs callback for rendering');
    renderCallback = require('./skeleton.js').renderSkeleton;
  }
  // remember
  if(node)
    currentNode = node;
  else
    node = currentNode || env.nodes[0];
  if(!node)
    return;

  // update interface list
  interfaces = env.getInterfaces();

  // title
  let sname = document.getElementById('sname');
  sname.textContent = (node.name || '') + ' (' + node.category + ')';
  let form = document.getElementById('params');

  // open parameter editor
  env.openPanel('params');

  // clear form
  while(form.firstChild)
    form.removeChild(form.firstChild);

  let newGroup = function(name){
    let g = document.createElement('fieldset');
    g.id = name;
    let l = document.createElement('legend');
    l.textContent = name.replace(/_/g, ' ');
    g.appendChild(l);
    return g;
  };
  let list = [].concat(parameterDescription);
  form.appendChild(newGroup('node'));
  while(list.length){
    let p = list.shift();
    // action depends on item
    if('key' in p){
      // skip index selection for empty lists
      if('from' in p && node[p.from].length === 0)
        continue;

      // only if existing
      let base = node;
      let tokens = p.key.split('/');
      let last = tokens[tokens.length - 1];
      for(let i = 0; base && i < tokens.length - 1; ++i){
        base = base[tokens[i]];
      }
      // base might be empty if searching an invalid tree
      if(!('initial' in p)){
        if(!base || !(last in base))
          continue;
      }

      // array values
      if(Array.isArray(base[last])){
        for(let i = 0; i < base[last].length; ++i)
          createParam(node, p, renderCallback, i);
      } else {
        // single value
        createParam(node, p, renderCallback);
      }

    } else if('match' in p){
      // subdivision
      let what = p.match;
      let groupName = node[what];
      // push subsection on the list
      let sublist = [];
      if(groupName in p.values){
        let group = newGroup(groupName);
        form.appendChild(group);
        p.values[groupName].forEach(v => {
          v.group = groupName;
          sublist.push(v);
        });
      }
      // directly process sublist
      list.unshift(...sublist);

    } else if('cond' in p){
      // conditional block
      let what = p.cond;
      let value = what[0] == '#' ? (node[what.substr(1)] || []).length : node[what];
      let groupName = p.group;
      let sub = [];
      let comp = null;
      // comparison
      if('equals' in p)
        comp = value == p.equals;
      else if('not' in p)
        comp = value != p.not;
      else if('greater_than' in p)
        comp = value > p.greater_than;
      else if('less_than' in p)
        comp = value < p.less_than;
      else if('at_least' in p)
        comp = value >= p.at_least;
      else if('at_most' in p)
        comp = value <= p.at_most;
      else if('is_in' in p)
        comp = p.is_in.includes(value);
      else
        comp = value;

      // evaluation sequence
      if(comp && 'then' in p){
        sub = p.then;
      } else if(!comp && 'otherwise' in p){
        sub = p.otherwise;
      }
      let sublist = [];
      sub.forEach(v => {
        v.group = groupName;
        sublist.push(v);
      });
      list.unshift(...sublist);

    } else if('block' in p){
      let groupName = p.block;
      form.appendChild(newGroup(groupName));
      let sublist = [];
      p.values.forEach(v => {
        v.group = groupName;
        sublist.push(v);
      });
      list.unshift(...sublist);

    } else if('fun' in p){
      let sublist = [];
      p.fun(node).forEach(v => {
        v.group = p.group;
        sublist.push(v);
      });
      list.unshift(...sublist);
    }
  }
}

function canUpdate(arg){
  return arg === Object(arg) && 'update' in arg;
}

function createParam(node, prop, renderCallback, arrayIdx){
  let currFocus = [node, prop.key, arrayIdx];
  // adding parameter
  let group = document.getElementById(prop.group || 'node');
  let type = prop.type;
  let base = node;
  let tokens = prop.key.split('/');
  for(let i = 0; i < tokens.length - 1; ++i)
    base = base[tokens[i]];
  let key = tokens[tokens.length - 1];
  let value;
  let title;
  let error = false;
  try {
    if(key in node.parameters){
      let p = node.parameters[key];
      if(p.expr){
        value = p.value;
        title = p.eval(); // to potentially trigger an error if invalid
      } else
        value = p.eval();
    } else {
      value = arrayIdx === undefined ? base[key] : base[key][arrayIdx];
    }
  } catch (e){
    // invalid expression
    error = e.message;
    if(key in node.parameters)
      value = node.parameters[key].value;
  }
  // default value
  if('initial' in prop && !value){
    value = prop.initial;
  }
  // separator
  if(prop.separate){
    let hr = document.createElement('hr');
    group.appendChild(hr);
  }

  // label
  let prefixes = [
    { before: 'branches/', after: 'branch ' },
    { before: /\//g,       after: ':' }
  ];
  let labelName = prefixes.reduce((name, p) => name.replace(p.before, p.after),
      prop.label ? prop.label : prop.key
  );
  let label = document.createElement('label');
  label.textContent = arrayIdx === undefined ? labelName : labelName + '[' + arrayIdx + ']';
  group.appendChild(label);
  
  // input field
  let input = null;
  let appendLater = [];
  switch(type){
    case ANG_PARAM:
    case FUN_PARAM:
    case INT_PARAM:
    case LAY_PARAM:
    case LOG_PARAM:
    case NUM_PARAM:
    case PAR_PARAM:
    case PAT_PARAM:
    case RNG_PARAM:
    case SHA_PARAM:
    case STR_PARAM:
      input = document.createElement('input');
      if(type == STR_PARAM)
        input.type = 'text';
      else if(type == PAR_PARAM){
        input.type = 'text';
        value = '#' + node.parent.id;
      } else if(type == FUN_PARAM){
        input.type = 'text';
        input.classList.add('function');
        value = value.toString();
      } else if(type == SHA_PARAM){
        input.type = 'text';
        input.classList.add('shader');
      } else if(type == PAT_PARAM){
        input.type = 'text';
        input.classList.add('pattern');
      } else if(type == INT_PARAM){
        input.type = 'number';
        input.min  = 0;
        input.step = 1;
      } else if(type == NUM_PARAM){
        input.type = 'number';
        input.min  = 0;
        input.step = 0.01;
      } else if(type == ANG_PARAM){
        input.type = 'number'; // 'range';
        input.min  = 0;
        input.max  = 360;
        input.step = 0.01;
      } else if(type == RNG_PARAM){
        input.type = 'number'; // 'range';
        input.min  = 0;
        input.max  = 1;
        input.step = 0.01;
      } else if(type == LOG_PARAM){
        input.type = 'checkbox';
        input.checked = !!value;
      } else if(type == LAY_PARAM){
        input.type = 'text';
        input.classList.add('layout');
      }
      if(key != 'id' && (input.type != 'text' || type == FUN_PARAM) && key in node.parameters){
        let tog = document.createElement('a');
        tog.classList.add('param');
        let param = node.parameters[key];
        if(param.expr){
          tog.title = "Use value";
          tog.classList.add('expr');
          input.type = 'text'; // for expression
          input.title = title; // for interpretation
          value = param.value;
        } else {
          tog.title = "Use expression";
          tog.classList.add('value');
        }
        if(error){
          input.classList.add('error');
          input.title = error;
        }
        tog.onclick = function(){
          if(param.expr){
            try {
              let val = param.eval();
              param.update(val);
            } catch (e){
              param.reset();
            }
          } else {
            param.update(JSON.stringify(value));
          }
          renderCallback();
          selectNode(node, renderCallback);
        };
        appendLater.push(tog);
      }
      if('textContent' in input)
        input.textContent = typeof value == 'string' ? value : JSON.stringify(value);
      break;

    case ENU_PARAM:
      input = document.createElement('select');
      prop.values.forEach(opName => {
        let option = document.createElement('option');
        option.name = opName;
        option.value = opName;
        option.textContent = opName;
        input.appendChild(option);
      });
      break;

    case ITF_PARAM:
      input = document.createElement('select');
      let itf = value;
      // empty option
      let option = document.createElement('option');
      option.value = sk.OPEN;
      option.textContent = '- open -';
      input.appendChild(option);
      // second empty option unless flat
      if(node.type != sk.FLAT){
        option = document.createElement('option');
        option.value = sk.CLOSED;
        option.textContent = '- closed -';
        input.appendChild(option);
      }
      // set option depending on connectedness
      if(itf.isConnected()){
        // set current option as other side
        let side = itf.otherSide(node);
        option = document.createElement('option');
        option.value = side.node.id + '/' + side.path;
        option.textContent = '#' + option.value;
        option.classList.add('current');
        input.appendChild(option);
        value = option.value;
      } else {
        value = itf.state;
      }
      interfaces.forEach(inter => {
        // only check available nodes = disconnected nodes
        if(inter.isConnected())
          return;
        // check if it's a potential interface to connect
        let other = inter.otherSide(node);
        if(!other)
          return;
        // there's a valid other node
        if(other.node.parent && other.node.parent.id == node.id)
          return; // it's an anchor pointing to this node
        // should be fine
        let option = document.createElement('option');
        option.value = other.node.id + '/' + other.path;
        option.textContent = '#' + option.value;
        input.appendChild(option);
      });
      // rotation
      let rotBreak = document.createElement('br');
      appendLater.push(rotBreak);
      let rotLabel = document.createElement('label');
      rotLabel.innerHTML = '&rarrhk; Rotation';
      rotLabel.classList.add('rotation-label');
      appendLater.push(rotLabel);
      let rotInput = document.createElement('input');
      rotInput.type = 'number';
      rotInput.min = -180;
      rotInput.max = 180;
      rotInput.value = itf.rotation;
      rotInput.onchange = function(){
        itf.rotation = parseFloat(rotInput.value);
        selectNode(node, renderCallback);
      };
      rotInput.classList.add('rotation-input');
      appendLater.push(rotInput);
      if(!itf.rotation || !itf.isConnected()){
        rotBreak.classList.add('hidden');
        rotLabel.classList.add('hidden');
        rotInput.classList.add('hidden');
        let rot = document.createElement('a');
        rot.classList.add('rotation');
        rot.onclick = function() {
          rotBreak.classList.toggle('hidden');
          rotLabel.classList.toggle('hidden');
          rotInput.classList.toggle('hidden');
          rot.classList.toggle('hidden');
        };
        rot.classList.add(itf.isConnected() ? 'connected' : 'disconnected');
        appendLater.push(rot);
      }
      break;

    default:
      console.log('Unsupported type=' + type);
      input = document.createElement('input');
      input.type = 'text';
      break;
  }
  // set extra parameters
  if('params' in prop){
    prop.params.forEach(str => {
      if(str && typeof str == 'string')
        input[str] = true;
      else if('key' in str && 'value' in str)
        input[str.key] = str.value;
    });
  }

  // update mechanism
  let update = function(val){
    if(node.parameters && key in node.parameters){
      try {
        node.parameters[key].update(val, true); // attempt update to parameters
        // note: if the expression is invalid => throws an error
      } catch(e){
        input.classList.add('error');
        input.title = e.message;
        return false; // did not update
      }
    } else if(arrayIdx === undefined){
      if(canUpdate(base[key]))
        base[key].update(val);
      else
        base[key] = val;
    } else {
      if(canUpdate(base[key][arrayIdx]))
        base[key][arrayIdx].update(val);
      else
        base[key][arrayIdx] = val;
    }
    return true;
  };

  // set principal parameters
  input.value = value;
  input.name = key;
  label.setAttribute('for', key);
  input.onchange = function(){
    if(type == LOG_PARAM){
      if(!update(input.checked))
        return;
    } else if(type == ITF_PARAM){
      // disconnecting vs connecting
      let thisInter = arrayIdx === undefined ? base[key] : base[key][arrayIdx];
      if(input.value == sk.OPEN || input.value == sk.CLOSED){
        if(thisInter.isConnected())
          thisInter.disconnect();
        thisInter.state = input.value; // update state
      } else {
        let tokens = input.value.split('/');
        let nodeId = parseInt(tokens[0]);
        // may be ourself
        if(nodeId == node.id)
          return; // nothing to do
        let path = tokens.slice(1).join('/');
        // find interface
        let otherInter = null;
        for(let i = 0; i < interfaces.length; ++i){
          let itf = interfaces[i];
          if(itf.isConnected())
            continue;
          if(itf.sides[0].node.id == nodeId
          && itf.sides[0].path == path){
            otherInter = itf;
          }
        }
        assert(thisInter && otherInter, 'Invalid state');
        // if it's current, nothing happens
        if(thisInter.id == otherInter.id)
          return;
        // else disconnect us first if we are already connected
        if(thisInter.isConnected()){
          thisInter.disconnect();
          thisInter = arrayIdx === undefined ? base[key] : base[key][arrayIdx];
        }
        thisInter.connectTo(otherInter);
      }
    } else {
      let val = input.value;
      if(input.type == 'number' && type != FUN_PARAM){
        val = parseFloat(val);
      } else if(type == ENU_PARAM){
        val = prop.values.find(v => v + '' == val); // get exact enumeration value
      }
      if(!update(val))
        return;
    }
    // remember focus
    lastFocus = currFocus;
    // render update
    renderCallback(type == ITF_PARAM || key in node.parameters); // , type == ITF_PARAM);
    // reload parameters since match may have changed
    selectNode(node, renderCallback);
  };

  // editor triggerring
  if(type == FUN_PARAM || type == SHA_PARAM || type == LAY_PARAM || type == PAT_PARAM){
    if(typeof value != 'string')
      input.value = JSON.stringify(value);
    input.onclick = function(){
      switch(type){
        case FUN_PARAM:
          editFunction(node, key, arrayIdx);
          break;
        case LAY_PARAM:
          editLayout(node, key);
          break;
        case PAT_PARAM:
          editPattern(node.id, 0);
          break;
        case SHA_PARAM:
          editShaper(node, key);
          break;
      }
    };
  }

  // input
  group.appendChild(input);
  // later children
  appendLater.forEach(el => {
    group.appendChild(el);
  });
  // line break
  group.appendChild(document.createElement('br'));

  // focus on it if last one with focus
  if(lastFocus && lastFocus.every((val, idx) => val == currFocus[idx])){
    input.focus();
  }
}

// export
module.exports = selectNode;
