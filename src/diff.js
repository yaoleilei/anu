  import {
      clone,
      extend,
      isEvent,
      getInstances,
      matchInstance,
      midway
  } from './util'
  import {
      applyComponentHook
  } from './lifecycle'
  import {
      transaction
  } from './transaction'
  import {
      toVnode
  } from './toVnode'

  import {
      patchStyle
  } from './style'

  import {
      addGlobalEventListener,
      getBrowserName
  } from './event'
  import {
      setControlledComponent
  } from './ControlledComponent'


  /**
   * 渲染组件
   * 
   * @param {any} instance 
   */
  export function updateComponent(instance) {
      var {
          props,
          state,
          context,
          vnode,
          prevProps,
          prevState
      } = instance
      prevState = prevState || state
      instance.props = prevProps
      instance.state = prevState
      var nextProps = props
      var nextState = state
      if (!instance.forceUpdate && applyComponentHook(instance, 4, nextProps, nextState, context) === false) {
          return dom //注意
      }
      applyComponentHook(instance, 5, nextProps, nextState, context)
      instance.props = nextProps
      instance.state = nextState

      if (instance.statelessRender) {
          var rendered = instance.statelessRender(nextProps, context)
      } else {
          rendered = transaction.renderWithoutSetState(instance)
      }
      //context只能孩子用，因此不要影响原instance.context
      if (instance.getChildContext) {
          context = extend(clone(context), instance.getChildContext());
      }

      var dom = diff(rendered, instance.vnode, vnode._hostParent, context)
      instance.vnode = rendered
      // rendered.dom = dom
      delete instance.prevState //方便下次能更新this.prevState
      instance.prevProps = props // 更新prevProps
      applyComponentHook(instance, 6, nextProps, nextState, context)
      return dom //注意
  }
  /**
   * call componentWillUnmount
   * 
   * @param {any} vnode 
   */
  function removeComponent(vnode) {
      var instance = vnode.instance

      applyComponentHook(instance, 7) //7
      vnode._hostParent = vnode._wrapperState = vnode.instance = void 666

      var ref = vnode.props.ref
      if (typeof ref === 'string') {
          var o = vnode._owner
          o && (o.refs[ref] = null)
      }

      vnode.props.children.forEach(function (el) {
          if (el.props) {
              removeComponent(el)
          }
      })
  }


  /**
   * 参数不要出现DOM,以便在后端也能运行
   * 
   * @param {any} vnode 新的虚拟DOM
   * @param {any} prevVnode 旧的虚拟DOM
   * @param {any} vParentNode 父虚拟DOM
   * @param {any} context 
   * @returns 
   */
  function diff(vnode, prevVnode, vParentNode, context) { //updateComponent
      var dom = prevVnode.dom
      var parentNode = vParentNode && vParentNode.dom
      var prevProps = prevVnode.props　 || {}
      var prevChildren = prevProps.children || []
      var Type = vnode.type

      //更新组件
      var isComponent = typeof Type === 'function'
      var instance = prevVnode.instance

      if (instance) {
          instance = isComponent && matchInstance(instance, Type)
          if (instance) { //如果类型相同，使用旧的实例进行 render新的虚拟DOM
              vnode.instance = instance
              var nextProps = vnode.props
              //处理非状态组件
              if (instance.statelessRender) {
                  instance.props = nextProps
                  instance.prevProps = prevProps
                  return updateComponent(instance, context)
              }

              prevProps = instance.prevProps

              instance.props = prevProps
              applyComponentHook(instance, 3, nextProps)
              instance.prevProps = prevProps
              instance.props = nextProps
              return updateComponent(instance, context)
          } else {
              if (prevVnode.type !== Type) {
                  removeComponent(prevVnode)
              }
          }
      }
      if (isComponent) {
          vnode._hostParent = vParentNode
          return toDOM(vnode, context, parentNode, prevVnode.dom)
      }
      if (!dom || prevVnode.type !== Type) { //这里只能是element 与#text
          var nextDom = document.createElement(Type)
          if (dom) {
              while (dom.firstChild) {
                  nextDom.appendChild(dom.firstChild)
              }
              if (parentNode) {
                  parentNode.replaceChild(nextDom, dom)
              }
          }
          dom = nextDom
      }
      //必须在diffProps前添加它的dom
      vnode.dom = dom
      diffProps(vnode.props, prevProps, vnode, prevVnode)
      if (!vnode._hasSetInnerHTML && vnode.props) {
          diffChildren(vnode.props.children, prevChildren, vnode, context)
      }
      var wrapperState = vnode._wrapperState
      if (wrapperState && wrapperState.postUpdate) { //处理select
          wrapperState.postUpdate(vnode)
      }
      return dom
  }
  var eventNameCache = {
      'onClick': 'click',
      'onChange': 'change'
  }

  function clickHack() {}
  let inMobile = 'ontouchstart' in document

  /**
   * 收集DOM到组件实例的refs中
   * 
   * @param {any} instance 
   * @param {any} ref 
   * @param {any} dom 
   */
  function patchRef(instance, ref, dom, mount) {
      if (typeof ref === 'function') {
          ref(instance)
      } else if (typeof ref === 'string') {
          instance.refs[ref] = dom
          dom.getDOMNode = getDOMNode
      }
  }
  //fix 0.14对此方法的改动，之前refs里面保存的是虚拟DOM
  function getDOMNode() {
      return this
  }

  var builtIdProperties = /^(?:className|id|title|selected|htmlFor|value|checked|disabled)$/
  /**
   * 
   * 修改dom的属性与事件
   * @export
   * @param {any} props 
   * @param {any} prevProps 
   * @param {any} vnode 
   * @param {any} prevVnode 
   */
  export function diffProps(props, prevProps, vnode, prevVnode) {
      if (props === prevProps) {
          return
      }
      var dom = vnode.dom

      var instance = vnode._owner
      if (prevVnode._wrapperState) {
          vnode._wrapperState = prevVnode._wrapperState
          delete prevVnode._wrapperState
      }

      for (let name in props) {
          if (name === 'children') {
              continue
          }
          var val = props[name]
          if (name === 'ref') {
              if (prevProps[name] !== val) {
                  instance && patchRef(instance, val, dom)
              }
              continue
          }
          if (name === 'style') {
              patchStyle(dom, prevProps.style || {}, val)
              continue
          }
          if (name === 'dangerouslySetInnerHTML') {
              var oldhtml = prevProps[name] && prevProps[name]._html
              vnode._hasSetInnerHTML = true
              if (val && val._html !== oldhtml) {
                  dom.innerHTML = val._html
              }
          }
          if (isEvent(name)) {
              if (!prevProps[name]) { //添加全局监听事件
                  var eventName = getBrowserName(name)
                  addGlobalEventListener(eventName)
              }
              if (inMobile && eventName === 'click') {
                  elem.addEventListener('click', clickHack)
              }
              var events = (dom.__events || (dom.__events = {}))
              events[name] = val
              continue
          }

          if (val !== prevProps[name]) {
              //移除属性
              if (val === false || val === void 666 || val === null) {
                  dom.removeAttribute(name)
              } else { //添加新属性
                  if (builtIdProperties.test(name)) {
                      val = val + ''
                      //特殊照顾value, 因为value可以是用户自己输入的，这时再触发onInput，再修改value，但这时它们是一致的
                      //<input value={this.state.value} onInput={(e)=>setState({value: e.target.value})} />
                      if (name !== 'value' || dom[name] !== val) {
                          dom[name] = val
                      }
                  } else {
                      dom.setAttribute(name, val + '')
                  }
              }
          }
      }
      //如果旧属性在新属性对象不存在，那么移除DOM
      for (let name in prevProps) {
          if (!(name in props)) {
              if (isEvent(name)) { //移除事件
                  var events = dom.__events || {}
                  delete events[name]
              } else { //移除属性
                  if (builtIdProperties.test(name)) {
                      dom[name] = ''
                  } else {
                      dom.removeAttribute(name)
                  }
              }
          }
      }
  }
  /**
   * 获取虚拟DOM对应的顶层组件实例的类型
   * 
   * @param {any} vnode 
   * @param {any} instance 
   * @param {any} pool 
   */
  function getTopComponentName(vnode, instance) {
      while (instance.parentInstance) {
          instance = nstance.parentInstance
      }
      var ctor = instance.statelessRender || instance.constructor
      return (ctor.displayName || ctor.name)
  }

  /**
   * 
   * 
   * @param {any} type 
   * @param {any} vnode 
   * @returns 
   */
  function computeUUID(type, vnode) {
      if (type === '#text') {
          return type + '/' + vnode.deep + '/' + vnode.text
      }
      return type + ':' + vnode.deep + (vnode.key !== null ? '/' + vnode.key : '')
  }

  /**
   * 
   * 
   * @param {any} newChildren 
   * @param {any} oldChildren 
   * @param {any} vParentNode 
   * @param {any} context 
   */
  function diffChildren(newChildren, oldChildren, vParentNode, context) {
      //第一步，根据实例的类型，nodeName, nodeValue, key与数组深度 构建hash
      var parentNode = vParentNode.dom
      var mapping = {}
      for (let i = 0, n = oldChildren.length; i < n; i++) {
          let vnode = oldChildren[i]
          let tag = vnode.instance ? getTopComponentName(vnode, vnode.instance) : vnode.type
          let uuid = computeUUID(tag, vnode)
          if (mapping[uuid]) {
              mapping[uuid].push(vnode)
          } else {
              mapping[uuid] = [vnode]
          }
      }

      //第二步，遍历新children, 从hash中取出旧节点
      var removedChildren = oldChildren.concat()
      for (let i = 0, n = newChildren.length; i < n; i++) {
          let vnode = newChildren[i];
          let Type = vnode.type
          let tag = typeof Type === 'function' ? (vnode._hasInstance = 1, Type.displatName || Type.name) : Type
          let uuid = computeUUID(tag, vnode)

          if (mapping[uuid]) {
              var matchNode = mapping[uuid].shift()
              if (!mapping[uuid].length) {
                  delete mapping[uuid]
              }
              if (matchNode) {
                  let index = removedChildren.indexOf(matchNode)
                  removedChildren.splice(index, 1)
                  vnode.prevVnode = matchNode
                  matchNode.use = true
              }
          }
      };


      //第三，逐一比较
      for (let i = 0, n = newChildren.length; i < n; i++) {
          let vnode = newChildren[i]
          let prevVnode = null
          if (vnode.prevVnode) {
              prevVnode = vnode.prevVnode
          } else {
              var k
              loop:
                  while (k = removedChildren.shift()) {
                      if (!k.use) {
                          prevVnode = k
                          break loop
                      }
                  }
          }
          vnode._hostParent = vParentNode
          if (vnode && prevVnode) { //假设两者都存在
              var prevDom = prevVnode.dom
              if (vnode.prevVnode && vnode._hasInstance) {
                  delete vnode.prevVnode
                  delete vnode._hasInstance
                  vnode.action = '重复利用旧的实例更新组件' //action只是调试用
                  diff(vnode, prevVnode, vParentNode, context)
              } else if (vnode.type === prevVnode.type) {
                  if (vnode.type === '#text' || vnode.type === '#comment') {
                      vnode.dom = prevDom

                      if (vnode.text !== prevVnode.text) {
                          vnode.action = '改文本'
                          vnode.dom.nodeValue = vnode.text
                      } else {
                          vnode.action = '不改文本'
                      }
                  } else { //元素节点的比较
                      vnode.action = '更新元素'
                      diff(vnode, prevVnode, vParentNode, context)
                  }
              } else if (vnode.type === '#text') { //#text === p
                  var dom = document.createTextNode(vnode.text)
                  vnode.dom = dom
                  parentNode.removeChild(prevDom)
                  vnode.action = '替换为文本'
                  removeComponent(prevVnode) //移除元素节点或组件
              } else if (vnode.type === '#comment') { //#text === p
                  var dom = document.createComment(vnode.text)
                  vnode.dom = dom
                  parentNode.removeChild(prevDom)
                  vnode.action = '替换为文本'
                  removeComponent(prevVnode) //移除元素节点或组件
              } else {
                  vnode.action = '替换为元素'
                  diff(vnode, prevVnode, vParentNode, context)
              }
              //当这个孩子是上级祖先传下来的，那么它是相等的
              if (vnode !== prevVnode) {
                  delete prevVnode.dom //clear reference
              }
          } else if (!prevVnode) { //添加新组件或元素节点
              vnode.action = '添加新' + (vnode.type === '#text' ? '文本' : '元素')
              if (!vnode.dom) {
                  var oldNode = oldChildren[i]

                  toDOM(vnode, context, parentNode, oldNode && oldNode.dom || null)
              }
          }

          if (!parentNode.contains(vnode.dom)) {
              parentNode.insertBefore(vnode.dom, newChildren[i].dom.nextSibling)
          }
      }

      //第4步，移除无用节点
      if (removedChildren.length) {
          for (let i = 0, n = removedChildren.length; i < n; i++) {
              let vnode = removedChildren[i]
              delete vnode._hostParent
              parentNode.removeChild(vnode.dom)
              vnode.props && removeComponent(vnode)
          }
      }

  }

  //var mountOrder = 0
  /**
   * 
   * 
   * @export
   * @param {VNode} vnode 
   * @param {DOM} context 
   * @param {DOM} parentNode ?
   * @param {DOM} replaced ?
   * @returns 
   */
  export function toDOM(vnode, context, parentNode, replaced) {
      vnode = toVnode(vnode, context)
      var dom, isElement
      if (vnode.type === '#comment') {
          dom = document.createComment(vnode.text)
      } else
      if (vnode.type === '#text') {
          dom = document.createTextNode(vnode.text)
      } else {
          dom = document.createElement(vnode.type)
          isElement = true
      }

      var instance = vnode.instance
      var canComponentDidMount = instance && !vnode.dom
      vnode.dom = dom
      if (isElement) {
          diffProps(vnode.props, {}, vnode, {})

          if (!vnode._hasSetInnerHTML) {
              diffChildren(vnode.props.children, [], vnode, context) //添加第4参数
          }
          setControlledComponent(vnode)
      }

      //尝试插入DOM树
      if (parentNode) {
          var instances, childInstance
          if (canComponentDidMount) { //判定能否调用componentDidMount方法
              instances = getInstances(instance)
             
          }
          if (replaced) {
              parentNode.replaceChild(dom, replaced)
          } else {
              parentNode.appendChild(dom)
          }
          if (instances) {
              //instance._mountOrder = mountOrder++;
              while (instance = instances.shift()) {
                  applyComponentHook(instance, 2)
              }
          }
      }
      return dom
  }
  //将Component中这个东西移动这里
  midway.immune.updateComponent = function updateComponentProxy() { //这里触发视图更新
      var instance = this.component
      if (!instance.vnode.dom) {
          var parentNode = instance.container
          instance.state = this.state //将merged state赋给它
          toDOM(instance.vnode, instance.context, parentNode)
      } else {
          updateComponent(this.component)
      }
      this.forceUpdate = false
  }