// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const { loadSkeleton, renderSkeleton } = require('./ui/skeleton.js');
const { editPattern, registerUpdateCallback } = require('./ui/pattern.js');
const { editCustom, registerUpdateCallback: registerCustomUpdateCallback } = require('./ui/custom.js');
const { editHistory, setHistoryType, loadLocalSnapshot, storeLocalSnapshot } = require('./ui/history.js');
const updateOutput = require('./ui/output.js');
const env = require('./env.js');
const Pattern = require('./pattern.js');

function init(actions){
  if(!actions)
    actions = [];
  if(typeof actions == 'string'){
    actions = actions.split(',').filter(str => str.length).map(token => {
      return token.split(':');
    });
  }
  for(let act of actions){
    let what, args;
    if(Array.isArray(act)){
      what = act[0];
      args = act.slice(1);
    } else {
      what = act;
      args = [];
    }
    switch(what){
      case 'open':
        env.openPanel(args.join());
        break;
      case 'close':
        env.closePanel(args.join());
        break;
      case 'swap':
        swapPanel(args.join());
        break;
      case 'set':
        document.getElementById(args[0]).value = args[1];
        break;
      case 'check':
        document.getElementById(args[0]).checked = true;
        break;
      case 'uncheck':
        document.getElementById(args[0]).checked = false;
        break;
      case 'output':
        updateOutput(true);
        break;
      case 'history':
        document.getElementById('history-type').value = args[0];
        setHistoryType(args[0]);
        break;
      default:
        console.log('Unsupported action ', what, ' with arguments ', args.join(':'));
        break;
    }
  }
}

function createOption(value, text){
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text || value;
  return option;
}

function initUI(){

  // preload pattern resources
  Pattern.preload();

  // render skeleton
  renderSkeleton(true);

  // create logic for file save / load
  const file = document.getElementById('file');
  const load = document.getElementById('load');
  const use = document.getElementById('use');
  load.onclick = function(){
    // transfer click
    file.click();
  };
  file.onchange = function(){
    if(file.files.length){
      loadSkeleton(file.files[0]);
    }
    file.value = ''; // to allow loading the same file multiple times
  };
  fetch('skeletons/list.json')
    .then(res => res.json())
    .then(json => {
    assert(Array.isArray(json), 'Invalid list');
    for(let { path } of json){
      use.appendChild(createOption(path));
    }
    use.onchange = () => {
      if(use.value.length == 0)
        return;
      const path = use.value;
      use.value = ''; // reset to default
      window.location.search = 'loadPath=skeletons/' + path;
      // window.location.reload();
    };
  });

  const filter = document.querySelector('#filter');
  filter.oninput = filter.onchange = filter.onpaste = filter.onkeyup = function(){
    renderSkeleton();
  };

  const save = document.querySelector('#save');
  save.onclick = function(){

    // let data = env.serializeSkeleton();
    const data = env.serialize();
    const str = JSON.stringify(data);
    const blob = new Blob([str], {type: "octet/stream"});
    const url = URL.createObjectURL(blob);
    
    // breaks spaces: save.href = 'data:application/octet-stream,' + JSON.stringify(list);
    save.href = url;
    save.download = 'skeleton.skel';
    
    // revoke url after click
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  // refreshing (for debug)
  document.getElementById('refresh').onclick = function(){
    renderSkeleton(true, true);
  };

  // history type
  document.getElementById('history-type').onchange = function(){
    setHistoryType(this.value);
  };
  loadLocalSnapshot();
  window.addEventListener('beforeunload', () => {
    storeLocalSnapshot(); // to allow reloading the last session
  });

  // ui parameters
  for(let prop of ['verbose', 'keepDuplicates']){
    const elem = document.getElementById(prop);
    elem.addEventListener('click', () => {
      env[prop] = elem.checked;
      renderSkeleton(true);
    });
  }

  // layout/dat parameters
  for(let [id, name] of [
    ['cast_on_type', 'castOnType'],
    ['cast_off_type', 'castOffType'],
    ['waste_fabric', 'wasteFabric'],
    ['use_dscs', 'useDSCS']
  ]){
    const elem = document.getElementById(id);
    if(typeof env.global[name] == 'string'){
      elem.addEventListener('change', () => {
        env.global[name] = elem.value;
        renderSkeleton(true);
      });
    } else {
      elem.addEventListener('click', () => {
        env.global[name] = elem.checked;
        renderSkeleton(true);
      });
    }
  }

  // update output on pattern edit (for dat / layout modes)
  const updateCallback = () => {
    let outputPanel = document.getElementById('output');
    if(outputPanel.classList.contains('dat')
    || outputPanel.classList.contains('layout'))
      updateOutput();
  };
  registerUpdateCallback('layout', updateCallback);

  registerCustomUpdateCallback('layout', updateCallback);

  // initialize panels
  initPanels();

  // initialize sidebar tabs
  for(let [panel, func] of [
    ['skeleton', renderSkeleton],
    ['pattern', () => editPattern('before')],
    ['custom',  () => editCustom()],
    ['history', editHistory]]){
    let tab = document.querySelector('#sidebar .tab[data-panel=' + panel + '-editor]');
    assert(tab, 'Selector did not match anything for panel ' + panel);
    tab.onclick = () => {
      if(togglePanel(panel + '-editor'))
        func();
    };
  }
  
  // @see https://developer.mozilla.org/en-US/docs/Web/API/URL/searchParams#Example
  let params = (new URL(document.location)).searchParams;
  let loadPath = params.get('loadPath');
  let initActions = params.get('init');
  if(loadPath){
    // note: this requires running from an http server (for security reasons)
    fetch(loadPath)
      .then(res => res.blob())
      .then(res => {
        loadSkeleton(res, () => init(initActions));
      })
      .catch(err => console.log('Load path error: ', err));
  } else
    init(initActions);
}

function panelName(el){
  return el.id.replace('-editor', '');
}

function createLink(clazz, title, text, func){
  let link = document.createElement('a');
  link.classList.add(clazz);
  link.title = title;
  if(text && text.length)
    link.textContent = text;
  link.onclick = func;
  return link;
}

function initPanels(){
  // initialize each panel and register them
  document.querySelectorAll('.panel').forEach(e => {
    // register globally
    let name = panelName(e);
    env.registerPanel(name, (state) => {
      togglePanel(e, state);
    });
    e.dataset.title = name;
    togglePanel(e, false); // closed by default

    // create links
    for(let [clazz, title, text, func] of [
      ['left', 'Swap to left', '<', () => { swapPanel(e); }],
      ['right', 'Swap to right', '>', () => { swapPanel(e); }],
      ['hide', 'Hide panel', '', () => { togglePanel(e); }]
    ]){
      let link = createLink(clazz, title, text, func);
      e.insertBefore(link, e.firstChild);
    }
  });
}

function swapPanel(panel, newPos){
  if(typeof panel == 'string')
    panel = document.getElementById(panel);
  assert(!!panel, 'Invalid panel');

  if(newPos === undefined)
    newPos = !panel.classList.contains('right');
  newPos = !!newPos;

  // if there's another panel on the same side, switch it off
  document.querySelectorAll('.panel').forEach(el => {
    // skip closed ones
    if(el == panel || el.classList.contains('closed'))
      return;
    // check if on the same side
    if(newPos == el.classList.contains('right')){
      // toggle off
      togglePanel(el, false);
    }
  });

  // set side information
  if(newPos)
    panel.classList.add('right');
  else
    panel.classList.remove('right');
}

function togglePanel(panel, newState){
  if(typeof panel == 'string')
    panel = document.getElementById(panel);
  assert(!!panel, 'Invalid panel');

  if(newState === undefined){
    newState = panel.classList.contains('closed');
  }

  // figure side of current panel
  let side = panel.classList.contains('right');

  if(newState){
    // check whether we need to toggle another panel off
    // or if we can toggle this current panel onto the other side
    let others = []; // the other visible panels
    document.querySelectorAll('.panel').forEach(el => {
      if(el != panel && !el.classList.contains('closed'))
        others.push(el);
    });
    // check occupancy
    let sameSide = others.filter(el => el.classList.contains('right') == side);
    let oppoSide = others.filter(el => el.classList.contains('right') != side);
    // is there a conflict?
    if(sameSide.length){
      // can we swap side to fix it?
      if(!oppoSide.length){
        if(side)
          panel.classList.remove('right');
        else
          panel.classList.add('right');
      } else {
        // we must remove the conflict
        for(let el of sameSide)
          togglePanel(el, false);
      }
    }
    // finally toggle this panel on
    panel.classList.remove('closed');
  } else {
    // toggle this panel off
    panel.classList.add('closed');
  }

  // potentially update sidebar
  let tab = document.querySelector('#sidebar .tab[data-panel=' + panel.id + ']');
  if(tab){
    if(newState)
      tab.classList.add('active');
    else
      tab.classList.remove('active');
  }
  return newState;
}


var initCallback = initUI;
if(window.attachEvent)
  window.attachEvent('onload', initCallback);
else {
  if(window.onload) {
    var currLoad = window.onload;
    window.onload = function(event){
      currLoad(event);
      initCallback(event);
    };
  } else
    window.onload = initCallback;
}
