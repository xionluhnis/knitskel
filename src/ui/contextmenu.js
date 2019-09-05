// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

// constants
let cmID = 0;

function ContextMenu(menu, options){
  this.id = cmID++;
  this.menu = menu || [];
  this.container = null;
  this.options = options || {};
  this.contextTarget = null;
  this.closeCallback = () => {
    this.hide();
  };
  assert(menu instanceof Array, 'Menu must be an array');
  // create menu
  this.reload();
}

ContextMenu.DIVIDER = 'divider';

ContextMenu.prototype.reload = function(menu, options) {
  if(menu)
    this.menu = menu;
  if(options)
    this.options = options;
  // generate element if necessary
  if(!this.container){
    this.container = document.createElement('div');
    this.container.className = 'contextmenu';
    this.container.id = this.options.id || 'cm-' + this.id;
    document.body.appendChild(this.container);
  }

  // remove all children
  while(this.container.firstChild)
    this.container.removeChild(this.container.firstChild);

  // create content
  this.container.appendChild(this.createMenu(this.menu));
};

function createElement(tag, clazz){
  let el = document.createElement(tag);
  el.className = clazz;
  return el;
}

ContextMenu.prototype.createMenu = function(menu){
  let list = document.createElement('ul');
  for(let item of menu){
    let li = document.createElement('li');
    li.menu = this;
    if(item == ContextMenu.DIVIDER){
      li.className = 'divider';
    } else {
      // for simplified strings
      if(typeof item == 'string')
        item = { text: item };
      // icon
      let icon = createElement('span', 'icon');
      icon.innerHTML = item.icon || this.options.defaultIcon || '';
      li.appendChild(icon);
      // text
      let text = createElement('span', 'text');
      text.innerHTML = item.text || 'undefined';
      li.appendChild(text);
      // submenu
      if(item.menu){
        let sub = createElement('span', 'sub');
        sub.innerHTML = item.subIcon || this.options.defaultSubIcon || '&#155;';
        li.appendChild(sub);
      }
      // disabled state
      if(item.disabled){
        li.setAttribute('disabled', '');
        li.classList.add('disabled');
      } else {
        // event information
        if(item.events){
          for(let key in item.events){
            li.addEventListener(key, item.events[key]);
          }
        } else if(item.event){
          li.addEventListener('click', item.event);
        }
        // submenu
        if(item.menu){
          li.appendChild(this.createMenu(item.menu));
        }
      }
    }
    list.appendChild(li);
  }
  return list;
};

ContextMenu.prototype.show = function(event, target) {
  // store target
  if(target !== undefined)
    this.contextTarget = target;
  else
    this.contextTarget = event.target;

  // workspace
  let coords = {
    x: event.clientX,
    y: event.clientY
  };
  let menuWidth = this.container.offsetWidth + 4;
  let menuHeight = this.container.offsetHeight + 4;
  let winWidth = window.innerWidth;
  let winHeight = window.innerHeight;
  let mouseOffset = this.options.mouseOffset || 2;

  // positioning
  if((winWidth - coords.x) < menuWidth){
    this.container.style.left = (winWidth - menuWidth) + 'px';
  } else {
    this.container.style.left = (coords.x + mouseOffset) + 'px';
  }
  if((winHeight - coords.y) < menuHeight){
    this.container.style.top = (winHeight - menuHeight) + 'px';
  } else {
    this.container.style.top = (coords.y + mouseOffset) + 'px';
  }

  // sub-menu positioning
  let { width, height } = ContextMenu.getSizeOf(this.container);
  if((winWidth - coords.x) < width){
    this.container.classList.add('border-right');
  } else {
    this.container.classList.remove('border-right');
  }
  if((winHeight - coords.y) < height){
    this.container.classList.add('border-bottom');
  } else {
    this.container.classList.remove('border-bottom');
  }

  // show by triggering visible class
  this.container.classList.add('visible');

  // add event for closing
  window.addEventListener('click', this.closeCallback);

  // prevent the default context menu to appear
  event.preventDefault();
};

ContextMenu.getSizeOf = function(el){
  let items = Array.from(el.getElementsByTagName('li'));
  // get list extents
  let extents = items.reduce(({ width, height }, li) => {
    return {
      width:  Math.max(width,  li.offsetWidth),
      height: Math.max(height, li.offsetHeight)
    };
  }, { width: 0, height: 0 });
  // compute full size by recursively looking at submenus
  return items.reduce((ext, li) => {
    let ul = li.getElementsByTagName('ul');
    if(ul[0]){
      let subExt = ContextMenu.getSizeOf(ul[0]);
      return {
        width:  Math.max(ext.width,  extents.width + subExt.width),
        height: Math.max(ext.height, extents.height + subExt.height)
      };
    } else
      return ext;
  }, extents);
};

ContextMenu.prototype.hide = function() {
  // remove visibility trick
  this.container.classList.remove('visible');
  // stop listening for clicks
  window.removeEventListener('click', this.closeCallback);
};

// export
module.exports = ContextMenu;
