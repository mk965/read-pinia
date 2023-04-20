import {
  watch,
  computed,
  inject,
  getCurrentInstance,
  reactive,
  DebuggerEvent,
  WatchOptions,
  UnwrapRef,
  markRaw,
  isRef,
  isReactive,
  effectScope,
  EffectScope,
  ComputedRef,
  toRaw,
  toRef,
  toRefs,
  Ref,
  ref,
  set,
  del,
  nextTick,
  isVue2,
} from 'vue-demi'
import {
  StateTree,
  SubscriptionCallback,
  _DeepPartial,
  isPlainObject,
  Store,
  _Method,
  DefineStoreOptions,
  StoreDefinition,
  _GettersTree,
  MutationType,
  StoreOnActionListener,
  _ActionsTree,
  SubscriptionCallbackMutation,
  DefineSetupStoreOptions,
  DefineStoreOptionsInPlugin,
  StoreGeneric,
  _StoreWithGetters,
  _ExtractActionsFromSetupStore,
  _ExtractGettersFromSetupStore,
  _ExtractStateFromSetupStore,
  _StoreWithState,
} from './types'
import { setActivePinia, piniaSymbol, Pinia, activePinia } from './rootStore'
import { IS_CLIENT, USE_DEVTOOLS } from './env'
import { patchObject } from './hmr'
import { addSubscription, triggerSubscriptions, noop } from './subscriptions'
import Log from '../utils/log'

type _ArrayType<AT> = AT extends Array<infer T> ? T : never

/**
 * 合并 reactive object
 * @param target 目标
 * @param patchToApply patch 传来的参数
 * @returns 
 */
function mergeReactiveObjects<
  T extends Record<any, unknown> | Map<unknown, unknown> | Set<unknown>
>(target: T, patchToApply: _DeepPartial<T>): T {
  // 处理 Map 实例
  if (target instanceof Map && patchToApply instanceof Map) {
    // 如果 patchToApply 是 Map 类型，则将值 set 到 target
    patchToApply.forEach((value, key) => target.set(key, value))
  }
  // 处理 Set 实例
  if (target instanceof Set && patchToApply instanceof Set) {
    // // 如果 patchToApply 是 Map 类型，则将值 add 到 target
    patchToApply.forEach(target.add, target)
  }

  // 无需遍历符号，因为剩下的情况都是无法序列化的情况
  for (const key in patchToApply) {
    // 避免 for in 方法遍历到原型链上的属性
    if (!patchToApply.hasOwnProperty(key)) continue
    const subPatch = patchToApply[key]
    const targetValue = target[key]
    // 如果是
    if (
      isPlainObject(targetValue) &&
      isPlainObject(subPatch) &&
      target.hasOwnProperty(key) &&
      !isRef(subPatch) &&
      !isReactive(subPatch)
    ) {
      // 如果被修改的值 修改前修改后都是 object 类型并且 target 上存在此属性、并且不是 ref 不是 isReactive，则递归 mergeReactiveObjects 达到修改嵌套 object 的目的
      // NOTE: 在这里，我想警告不一致的类型，但这是不可能的，因为在设置存储中，一个属性的值可能会以某种类型开始，例如 一个 Map，然后出于某种原因，在 SSR 期间，将其更改为“undefined”。 当尝试 hydrate 时，我们想用 `undefined` 覆盖 Map。
      target[key] = mergeReactiveObjects(targetValue, subPatch)
    } else {
      // @ts-expect-error: subPatch is a valid value
      target[key] = subPatch
    }
  }

  return target
}

const skipHydrateSymbol = __DEV__
  ? Symbol('pinia:skipHydration')
  : /* istanbul ignore next */ Symbol()
const skipHydrateMap = /*#__PURE__*/ new WeakMap<any, any>()

/**
 * Tells Pinia to skip the hydration process of a given object. This is useful in setup stores (only) when you return a
 * stateful object in the store but it isn't really state. e.g. returning a router instance in a setup store.
 *
 * @param obj - target object
 * @returns obj
 */
export function skipHydrate<T = any>(obj: T): T {
  return isVue2
    ? // in @vue/composition-api, the refs are sealed so defineProperty doesn't work...
      /* istanbul ignore next */ skipHydrateMap.set(obj, 1) && obj
    : Object.defineProperty(obj, skipHydrateSymbol, {})
}

/**
 * Returns whether a value should be hydrated
 * 返回这个值是否应该被混合
 *
 * @param obj - 需要验证的变量
 * @returns 如果 obj 需要被 Hydrate 则返回 true
 */
function shouldHydrate(obj: any) {
  return isVue2
    ? /* istanbul ignore next */ !skipHydrateMap.has(obj)
    : !isPlainObject(obj) || !obj.hasOwnProperty(skipHydrateSymbol)
}

const { assign } = Object

function isComputed<T>(value: ComputedRef<T> | unknown): value is ComputedRef<T>
function isComputed(o: any): o is ComputedRef {
  return !!(isRef(o) && (o as any).effect)
}

/**
 * 创建 选项式 store
 * @param id Store ID
 * @param options 配置选项
 * @param pinia Pinia 实例
 * @param hot 热更新相关
 * @returns 创建的 store
 */
function createOptionsStore<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A extends _ActionsTree
>(
  id: Id,
  options: DefineStoreOptions<Id, S, G, A>,
  pinia: Pinia,
  hot?: boolean
): Store<Id, S, G, A> {
  Log("createOptionsStore()");
  const { state, actions, getters } = options

  const initialState: StateTree | undefined = pinia.state.value[id]

  let store: Store<Id, S, G, A>

  /**
   * 自定义一个 setup 函数
   * @returns store
   */
  function setup() {
    if (!initialState && (!__DEV__ || !hot)) {
      /* istanbul ignore if */
      if (isVue2) {
        set(pinia.state.value, id, state ? state() : {})
      } else {
        pinia.state.value[id] = state ? state() : {}
      }
    }

    // 避免在 pinia.state.value 中创建 state
    const localState =
      __DEV__ && hot
        ? // 使用 ref() 解包状态中的引用
          toRefs(ref(state ? state() : {}).value)
        : toRefs(pinia.state.value[id])

    return assign(
      localState,
      actions,
      Object.keys(getters || {}).reduce((computedGetters, name) => {
        if (__DEV__ && name in localState) {
          // getter 不能和 state 属性同名
          console.warn(
            `[🍍]: A getter cannot have the same name as another state property. Rename one of them. Found with "${name}" in store "${id}".`
          )
        }

        // 把 getter 转为 computed
        computedGetters[name] = markRaw(
          computed(() => {
            setActivePinia(pinia)
            // it was created just before
            const store = pinia._s.get(id)!

            // allow cross using stores
            /* istanbul ignore next */
            if (isVue2 && !store._r) return

            // @ts-expect-error
            // return getters![name].call(context, context)
            // TODO: avoid reading the getter while assigning with a global variable
            return getters![name].call(store, store)
          })
        )
        return computedGetters
      }, {} as Record<string, ComputedRef>)
    )
  }

  store = createSetupStore(id, setup, options, pinia, hot, true)

  return store as any
}

/**
 * 创建组合式 Store
 * @param $id Store ID
 * @param setup defineStore 或者 createOptionsStore 传入的 setup 函数
 * @param options 配置选项，state、getter、actions 等。
 * @param pinia Pinia 实例
 * @param hot 热更新相关
 * @param isOptionsStore 是否是 选项式 Store 创建
 * @returns 创建的 store
 */
function createSetupStore<
  Id extends string,
  SS extends Record<any, unknown>,
  S extends StateTree,
  G extends Record<string, _Method>,
  A extends _ActionsTree
>(
  $id: Id,
  setup: () => SS,
  options:
    | DefineSetupStoreOptions<Id, S, G, A>
    | DefineStoreOptions<Id, S, G, A> = {},
  pinia: Pinia,
  hot?: boolean,
  isOptionsStore?: boolean
): Store<Id, S, G, A> {
  Log("createSetupStore()");

  // EffectScope
  // 创建一个 effect 作用域，可以捕获其中所创建的响应式副作用 (即计算属性和侦听器)，这样捕获到的副作用可以一起处理。对于该 API 的使用细节，请查阅对应的 RFC。
  // 详见：https://vuejs.org/api/reactivity-advanced.html#effectscope
  let scope!: EffectScope


  // 从 options 合并得到 optionsForPlugin
  // 插件的配置
  const optionsForPlugin: DefineStoreOptionsInPlugin<Id, S, G, A> = assign(
    { actions: {} as A },
    options
  )

  // 如果当前 pinia 实例没有被激活则抛出错误
  /* istanbul ignore if */
  if (__DEV__ && !pinia._e.active) {
    throw new Error('Pinia destroyed')
  }

  // $subscribe 的订阅选项
  const $subscribeOptions: WatchOptions = {
    deep: true,
    // flush: 'post',
  }
  // 如果不是 vue2，对 vue3 做特殊处理
  /* istanbul ignore else */
  if (__DEV__ && !isVue2) {
    // 订阅选项，当触发的时候调用
    $subscribeOptions.onTrigger = (event) => {
      // 如果正在监听，则将此事件赋值给 debug 事件（数组）
      /* istanbul ignore else */
      if (isListening) {
        debuggerEvents = event
        // 防止在 (store 正在构建时 并且 在 pinia 设置 state 的时候) 触发
      } else if (isListening == false && !store._hotUpdating) {
        // 让 patch 稍后将所有事件一起发送
        /* istanbul ignore else */
        if (Array.isArray(debuggerEvents)) {
          // 如果是数组则将当前事件 push 进去，否则抛出错误
          debuggerEvents.push(event)
        } else {
          // 🍍 debuggerEvents 应该是一个数组。 这很可能是内部 Pinia 错误
          console.error(
            '🍍 debuggerEvents should be an array. This is most likely an internal Pinia bug.'
          )
        }
      }
    }
  }

  // internal state
  let isListening: boolean // set to true at the end                                  // 是否正在监听
  let isSyncListening: boolean // set to true at the end                              // 是否同步监听
  let subscriptions: SubscriptionCallback<S>[] = markRaw([])                    // 所有订阅回调
  let actionSubscriptions: StoreOnActionListener<Id, S, G, A>[] = markRaw([])   // action 订阅
  let debuggerEvents: DebuggerEvent[] | DebuggerEvent                                 // debug 选项
  const initialState = pinia.state.value[$id] as UnwrapRef<S> | undefined             // 初始化状态

  // 如果已设置 optionStore，则不设置 option stores
  // by the setup
  if (!isOptionsStore && !initialState && (!__DEV__ || !hot)) {
    // 对于 vue2 特殊处理
    /* istanbul ignore if */
    if (isVue2) {
      set(pinia.state.value, $id, {})
    } else {
      pinia.state.value[$id] = {}
    }
  }

  // 热更新状态
  const hotState = ref({} as S)

  // 避免触发太多的监听者
  // https://github.com/vuejs/pinia/issues/1129
  let activeListener: Symbol | undefined
  /**
   * $patch 函数传递方式
   * @param stateMutation 
   * @example store.$patch((state) => state.count += 200);
   */
  function $patch(stateMutation: (state: UnwrapRef<S>) => void): void
  /**
   * $patch 对象传递方式
   * @param partialState 
   * @example store.$patch({ count: 100 });
   */
  function $patch(partialState: _DeepPartial<UnwrapRef<S>>): void
  function $patch(
    partialStateOrMutator:
      | _DeepPartial<UnwrapRef<S>>
      | ((state: UnwrapRef<S>) => void)
  ): void {
    Log('$patch', partialStateOrMutator);
    // 订阅收集器，保存收集到的订阅者
    let subscriptionMutation: SubscriptionCallbackMutation<S>
    isListening = isSyncListening = false
    // 重置 debugger 事件，因为 patches 是同步的
    /* istanbul ignore else */
    if (__DEV__) {
      debuggerEvents = []
    }
    // 对两种传参方式进行兼容
    // 如果参数是函数
    if (typeof partialStateOrMutator === 'function') {
      // 如果是函数，直接调用，并把 state 传过去
      partialStateOrMutator(pinia.state.value[$id] as UnwrapRef<S>)
      // 收集订阅，分别保存类型、id、事件
      subscriptionMutation = {
        type: MutationType.patchFunction,
        storeId: $id,
        events: debuggerEvents as DebuggerEvent[],
      }
    } else {
      // 如果传来的是 object
      // merge 参数对象到当前 store 的 state
      mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator)
      subscriptionMutation = {
        type: MutationType.patchObject,
        payload: partialStateOrMutator,
        storeId: $id,
        events: debuggerEvents as DebuggerEvent[],
      }
    }
    // 
    const myListenerId = (activeListener = Symbol())
    nextTick().then(() => {
      if (activeListener === myListenerId) {
        isListening = true
      }
    })
    isSyncListening = true
    // 在上方逻辑中，我们将 isListening isSyncListening 重置为 false，不会触发 $subscribe 中的 callback，所以需要手动进行订阅发布
    triggerSubscriptions(
      subscriptions,
      subscriptionMutation,
      pinia.state.value[$id] as UnwrapRef<S>
    )
  }

  /**
   * $reset
   * 只有 选项式 构建的才可以使用此方法，
   * 因为 state: () => ({count: 1}) 是一个函数，只要重新调用就可以获取原始值，
   * 而 组合式 构建的话 state 以 ref() 的形式实现，无法获取原始值。
   */
  const $reset = isOptionsStore
    ? function $reset(this: _StoreWithState<Id, S, G, A>) {
        const { state } = options as DefineStoreOptions<Id, S, G, A>
        // 取出 options 中的 state 函数重新执行，以获取到原始 state
        const newState = state ? state() : {}
        // 使用 $patch 更新 state，并分发订阅
        this.$patch(($state) => {
          assign($state, newState)
        })
      }
    : /* istanbul ignore next */
    __DEV__
    ? () => {
        // 如果是组合式语法构建的话，抛出错误，因为 ref() 不能获取到原始值
        throw new Error(
          `🍍: Store "${$id}" is built using the setup syntax and does not implement $reset().`
        )
      }
    // noop 是个空函数，生产环境不抛出错误
    : noop

  /**
   * $dispose
   * 停止 store 的相关作用域，并从 store 注册表中删除它。 
   * 插件可以覆盖此方法来清理已添加的任何副作用函数。 例如， devtools 插件停止显示来自 devtools 的已停止的 store。
   */
  function $dispose() {
    scope.stop()
    subscriptions = []
    actionSubscriptions = []
    pinia._s.delete($id)
  }

  /**
   * 包装一个 action 来处理订阅。
   *
   * @param name - action 的名字
   * @param action - action to wrap
   * @returns 包装完的 action
   */
  function wrapAction(name: string, action: _Method) {
    return function (this: any) {
      setActivePinia(pinia)
      const args = Array.from(arguments)

      const afterCallbackList: Array<(resolvedReturn: any) => any> = []
      const onErrorCallbackList: Array<(error: unknown) => unknown> = []
      function after(callback: _ArrayType<typeof afterCallbackList>) {
        afterCallbackList.push(callback)
      }
      function onError(callback: _ArrayType<typeof onErrorCallbackList>) {
        onErrorCallbackList.push(callback)
      }

      // @ts-expect-error
      triggerSubscriptions(actionSubscriptions, {
        args,
        name,
        store,
        after,
        onError,
      })

      let ret: any
      try {
        ret = action.apply(this && this.$id === $id ? this : store, args)
        // handle sync errors
      } catch (error) {
        triggerSubscriptions(onErrorCallbackList, error)
        throw error
      }

      if (ret instanceof Promise) {
        return ret
          .then((value) => {
            triggerSubscriptions(afterCallbackList, value)
            return value
          })
          .catch((error) => {
            triggerSubscriptions(onErrorCallbackList, error)
            return Promise.reject(error)
          })
      }

      // trigger after callbacks
      triggerSubscriptions(afterCallbackList, ret)
      return ret
    }
  }

  const _hmrPayload = /*#__PURE__*/ markRaw({
    actions: {} as Record<string, any>,
    getters: {} as Record<string, Ref>,
    state: [] as string[],
    hotState,
  })

  /**
   * 具有 state 和 功能 的基本 store，但不能直接使用。
   */
  const partialStore = {
    _p: pinia,
    // _s: scope,
    $id,
    /**
     * 设置一个回调，当一个 action 即将被调用时，就会被调用。 回调接收一个对象， 其包含被调用 action 的所有相关信息：
     * - store: 被调用的 store
     * - name: action 的名称
     * - args: 传递给 action 的参数
     */
    $onAction: addSubscription.bind(null, actionSubscriptions),
    $patch,
    $reset,
    /**
     * 当状态发生变化时被调用
     * 它会返回一个用来移除此回调的函数
     * @param callback 回调
     * @param options 配置
     * @returns 返回一个取消订阅的函数，调用次函数时订阅就被取消了
     */
    $subscribe(callback, options = {}) {
      Log("$subscribe", options);
      // 取消订阅函数
      const removeSubscription = addSubscription(
        subscriptions,
        callback,
        options.detached,
        () => stopWatcher()
      )
      // effectScope：创建一个 effect 作用域，可以补货其中所创建的响应式副作用 (即计算属性和侦听器)，这里用于捕获 watch，以便于销毁store的时候统一处理。
      const stopWatcher = scope.run(() =>
        // 从这里可以看出 pinia 的订阅响应式主要是依赖 vue 的 watch
        watch(
          () => pinia.state.value[$id] as UnwrapRef<S>,
          (state) => {
            if (options.flush === 'sync' ? isSyncListening : isListening) {
              callback(
                {
                  storeId: $id,
                  type: MutationType.direct,
                  events: debuggerEvents as DebuggerEvent,
                },
                state
              )
            }
          },
          assign({}, $subscribeOptions, options)
        )
      )!

      return removeSubscription
    },
    $dispose,
  } as _StoreWithState<Id, S, G, A>

  /* istanbul ignore if */
  if (isVue2) {
    // _r 就是 ready，设为 false 未准备好开始
    partialStore._r = false
  }

  /**
   * 创建一个响应式的 store 对象
   * 将基础函数合并到 store 中
   */
  const store: Store<Id, S, G, A> = reactive(
    __DEV__ || USE_DEVTOOLS
      ? assign(
          {
            _hmrPayload,
            _customProperties: markRaw(new Set<string>()), // devtools custom properties
          },
          partialStore
          // must be added later
          // setupStore
        )
      : partialStore
  ) as unknown as Store<Id, S, G, A>

  // store the partial store now so the setup of stores can instantiate each other before they are finished without
  // creating infinite loops.
  // 将 store 存储到当前 pinia 实例中
  // 现在存储 partial store，以便 store 的 setup 可以在完成之前相互实例化，而不会创建无限循环。
  pinia._s.set($id, store)

  // TODO: 想法创建 skipSerialize 将属性标记为不可序列化并跳过它们
  // 在当前 pinia 实例的缓存中新建一个作用域，在作用域中执行 setup 函数
  // 执行的结果为 store 。 example: { count: ObjectRefImpl, increment: Function () }
  const setupStore = pinia._e.run(() => {
    scope = effectScope()
    return scope.run(() => setup())
  })!

  // 覆盖现有操作以支持 $onAction
  for (const key in setupStore) {
    const prop = setupStore[key]

    // ((如果是 ref) 并且 (不是 computed)) 或者 (是 reactive)
    if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
      // 将其标记为要序列化的状态
      if (__DEV__ && hot) {
        set(hotState.value, key, toRef(setupStore as any, key))
        // createOptionStore 直接在 pinia.state.value 中设置 state，所以我们可以跳过它
      } else if (!isOptionsStore) {
        // 如果是 optionsStore 方式创建，option 结构已经在 createOptionsStore 将其加入 pinia
        // in setup stores we must hydrate the state and sync pinia state tree with the refs the user just created
        // 在 setup stores 中，我们必须将 state 和 pinia 状态树与用户刚刚创建的引用同步
        if (initialState && shouldHydrate(prop)) {
          if (isRef(prop)) {
            prop.value = initialState[key]
          } else {
            // 可能是一个 reactive 对象，递归
            // mergeReactiveObjects 合并 reactive 对象
            // @ts-expect-error: prop is unknown
            mergeReactiveObjects(prop, initialState[key])
          }
        }
        // 将 ref 转移到 pinia state 以保持一切同步
        /* istanbul ignore if */
        if (isVue2) {
          set(pinia.state.value[$id], key, prop)
        } else {
          pinia.state.value[$id][key] = prop
        }
      }

      /* istanbul ignore else */
      if (__DEV__) {
        _hmrPayload.state.push(key)
      }
      // 否则，如果是函数类型，那么它就是一个 action
    } else if (typeof prop === 'function') {
      // 如果是重写这个值，应该避免使用 wrapAction 重复包装
      // @ts-expect-error: we are overriding the function we avoid wrapping if
      const actionValue = __DEV__ && hot ? prop : wrapAction(key, prop)
      // 这是一个热更新模块替换 store，因为 hotUpdate 方法需要在正确的上下文中执行它
      /* istanbul ignore if */
      if (isVue2) {
        set(setupStore, key, actionValue)
      } else {
        // @ts-expect-error
        setupStore[key] = actionValue
      }

      /* istanbul ignore else */
      if (__DEV__) {
        _hmrPayload.actions[key] = prop
      }

      // 将 actions 存储到插件配置的 actions 数组，以便它们可以在插件中使用
      // @ts-expect-error
      optionsForPlugin.actions[key] = prop
    } else if (__DEV__) {
      // 为 devtools 添加 getter
      if (isComputed(prop)) {
        _hmrPayload.getters[key] = isOptionsStore
          ? // @ts-expect-error
            options.getters[key]
          : prop
        if (IS_CLIENT) {
          const getters: string[] =
            (setupStore._getters as string[]) ||
            // @ts-expect-error: same
            ((setupStore._getters = markRaw([])) as string[])
          getters.push(key)
        }
      }
    }
  }

  // 添加 state、getter 和 action 属性
  /* istanbul ignore if */
  if (isVue2) {
    Object.keys(setupStore).forEach((key) => {
      set(store, key, setupStore[key])
    })
  } else {
    assign(store, setupStore)
    // 允许使用 `storeToRefs()` 检索 reactive 对象。 必须在分配给 reactive 对象后调用。
    /**
     * storeToRefs(): https://pinia.vuejs.org/zh/api/modules/pinia.html#storetorefs
     * 创建一个引用对象，包含 store 的所有 state、 getter 和 plugin 添加的 state 属性。 类似于 toRefs()，但专门为 Pinia store 设计， 所以 method 和非响应式属性会被完全忽略。
     */
    // 使 `storeToRefs()` 与 `reactive()` 一起工作#799
    assign(toRaw(store), setupStore)
  }

  // use this instead of a computed with setter to be able to create it anywhere
  // without linking the computed lifespan to wherever the store is first
  // created.
  // 使用它而不是 computed with setter 可以在任何地方创建它，而无需将计算的生命周期链接到首次创建 store 的任何地方。
  // 给 store 定义 $state 属性，方便获取全部的 state
  Object.defineProperty(store, '$state', {
    get: () => (__DEV__ && hot ? hotState.value : pinia.state.value[$id]),
    set: (state) => {
      /* istanbul ignore if */
      if (__DEV__ && hot) {
        throw new Error('cannot set hotState')
      }
      $patch(($state) => {
        assign($state, state)
      })
    },
  })

  // add the hotUpdate before plugins to allow them to override it
  // 在插件之前添加 hotUpdate 以允许它们覆盖它
  // 热更新相关，不细读了
  /* istanbul ignore else */
  if (__DEV__) {
    store._hotUpdate = markRaw((newStore) => {
      store._hotUpdating = true
      newStore._hmrPayload.state.forEach((stateKey) => {
        if (stateKey in store.$state) {
          const newStateTarget = newStore.$state[stateKey]
          const oldStateSource = store.$state[stateKey]
          if (
            typeof newStateTarget === 'object' &&
            isPlainObject(newStateTarget) &&
            isPlainObject(oldStateSource)
          ) {
            patchObject(newStateTarget, oldStateSource)
          } else {
            // transfer the ref
            newStore.$state[stateKey] = oldStateSource
          }
        }
        // patch direct access properties to allow store.stateProperty to work as
        // store.$state.stateProperty
        set(store, stateKey, toRef(newStore.$state, stateKey))
      })

      // remove deleted state properties
      Object.keys(store.$state).forEach((stateKey) => {
        if (!(stateKey in newStore.$state)) {
          del(store, stateKey)
        }
      })

      // avoid devtools logging this as a mutation
      isListening = false
      isSyncListening = false
      pinia.state.value[$id] = toRef(newStore._hmrPayload, 'hotState')
      isSyncListening = true
      nextTick().then(() => {
        isListening = true
      })

      for (const actionName in newStore._hmrPayload.actions) {
        const action: _Method = newStore[actionName]

        set(store, actionName, wrapAction(actionName, action))
      }

      // TODO: does this work in both setup and option store?
      for (const getterName in newStore._hmrPayload.getters) {
        const getter: _Method = newStore._hmrPayload.getters[getterName]
        const getterValue = isOptionsStore
          ? // special handling of options api
            computed(() => {
              setActivePinia(pinia)
              return getter.call(store, store)
            })
          : getter

        set(store, getterName, getterValue)
      }

      // remove deleted getters
      Object.keys(store._hmrPayload.getters).forEach((key) => {
        if (!(key in newStore._hmrPayload.getters)) {
          del(store, key)
        }
      })

      // remove old actions
      Object.keys(store._hmrPayload.actions).forEach((key) => {
        if (!(key in newStore._hmrPayload.actions)) {
          del(store, key)
        }
      })

      // update the values used in devtools and to allow deleting new properties later on
      store._hmrPayload = newStore._hmrPayload
      store._getters = newStore._getters
      store._hotUpdating = false
    })
  }

  if (USE_DEVTOOLS) {
    const nonEnumerable = {
      writable: true,
      configurable: true,
      // avoid warning on devtools trying to display this property
      enumerable: false,
    }

    // avoid listing internal properties in devtools
    ;(['_p', '_hmrPayload', '_getters', '_customProperties'] as const).forEach(
      (p) => {
        Object.defineProperty(
          store,
          p,
          assign({ value: store[p] }, nonEnumerable)
        )
      }
    )
  }

  /* istanbul ignore if */
  if (isVue2) {
    // mark the store as ready before plugins
    store._r = true
  }

  // apply 全部插件
  pinia._p.forEach((extender) => {
    console.log("插件安装：", extender);
    // 如果使用开发工具
    /* istanbul ignore else */
    if (USE_DEVTOOLS) {
      const extensions = scope.run(() =>
        // 调用插件，并传入参数
        extender({
          store,
          app: pinia._a,
          pinia,
          options: optionsForPlugin,
        })
      )!
      Object.keys(extensions || {}).forEach((key) =>
        store._customProperties.add(key)
      )
      assign(store, extensions)
    } else {
      // 这里将插件返回的属性合并到 store 中
      assign(
        store,
        scope.run(() =>
          extender({
            store,
            app: pinia._a,
            pinia,
            options: optionsForPlugin,
          })
        )!
      )
    }
  })

  if (
    __DEV__ &&
    store.$state &&
    typeof store.$state === 'object' &&
    typeof store.$state.constructor === 'function' &&
    !store.$state.constructor.toString().includes('[native code]')
  ) {
    console.warn(
      `[🍍]: The "state" must be a plain object. It cannot be\n` +
        `\tstate: () => new MyClass()\n` +
        `Found in store "${store.$id}".`
    )
  }

  // only apply hydrate to option stores with an initial state in pinia
  // 仅将 hydrate 应用于初始状态为 pinia 的 option store
  // hydrate SSR 时使用
  if (
    initialState &&
    isOptionsStore &&
    (options as DefineStoreOptions<Id, S, G, A>).hydrate
  ) {
    ;(options as DefineStoreOptions<Id, S, G, A>).hydrate!(
      store.$state,
      initialState
    )
  }

  isListening = true
  isSyncListening = true
  return store
}

/**
 * Extract the actions of a store type. Works with both a Setup Store or an
 * Options Store.
 */
export type StoreActions<SS> = SS extends Store<
  string,
  StateTree,
  _GettersTree<StateTree>,
  infer A
>
  ? A
  : _ExtractActionsFromSetupStore<SS>

/**
 * Extract the getters of a store type. Works with both a Setup Store or an
 * Options Store.
 */
export type StoreGetters<SS> = SS extends Store<
  string,
  StateTree,
  infer G,
  _ActionsTree
>
  ? _StoreWithGetters<G>
  : _ExtractGettersFromSetupStore<SS>

/**
 * Extract the state of a store type. Works with both a Setup Store or an
 * Options Store. Note this unwraps refs.
 */
export type StoreState<SS> = SS extends Store<
  string,
  infer S,
  _GettersTree<StateTree>,
  _ActionsTree
>
  ? UnwrapRef<S>
  : _ExtractStateFromSetupStore<SS>

// type a1 = _ExtractStateFromSetupStore<{ a: Ref<number>; action: () => void }>
// type a2 = _ExtractActionsFromSetupStore<{ a: Ref<number>; action: () => void }>
// type a3 = _ExtractGettersFromSetupStore<{
//   a: Ref<number>
//   b: ComputedRef<string>
//   action: () => void
// }>

/**
 * Creates a `useStore` function that retrieves the store instance
 * 创建检索存储实例的 ‘useStore’ 的函数
 *
 * @param id - id of the store (must be unique) 唯一的 store id
 * @param options - options to define the store 定义 store 的选项
 */
export function defineStore<
  Id extends string,
  S extends StateTree = {},
  G extends _GettersTree<S> = {},
  // cannot extends ActionsTree because we loose the typings
  A /* extends ActionsTree */ = {}
>(
  id: Id,
  options: Omit<DefineStoreOptions<Id, S, G, A>, 'id'>
): StoreDefinition<Id, S, G, A>

/**
 * Creates a `useStore` function that retrieves the store instance
 *
 * @param options - options to define the store
 */
export function defineStore<
  Id extends string,
  S extends StateTree = {},
  G extends _GettersTree<S> = {},
  // cannot extends ActionsTree because we loose the typings
  A /* extends ActionsTree */ = {}
>(options: DefineStoreOptions<Id, S, G, A>): StoreDefinition<Id, S, G, A>

/**
 * Creates a `useStore` function that retrieves the store instance
 *
 * @param id - id of the store (must be unique)
 * @param storeSetup - function that defines the store
 * @param options - extra options
 */
export function defineStore<Id extends string, SS>(
  id: Id,
  storeSetup: () => SS,
  options?: DefineSetupStoreOptions<
    Id,
    _ExtractStateFromSetupStore<SS>,
    _ExtractGettersFromSetupStore<SS>,
    _ExtractActionsFromSetupStore<SS>
  >
): StoreDefinition<
  Id,
  _ExtractStateFromSetupStore<SS>,
  _ExtractGettersFromSetupStore<SS>,
  _ExtractActionsFromSetupStore<SS>
>
export function defineStore(
  // TODO: add proper types from above
  idOrOptions: any,
  setup?: any,
  setupOptions?: any
): StoreDefinition {
  let id: string
  let options:
    | DefineStoreOptions<
        string,
        StateTree,
        _GettersTree<StateTree>,
        _ActionsTree
      >
    | DefineSetupStoreOptions<
        string,
        StateTree,
        _GettersTree<StateTree>,
        _ActionsTree
    >

  Log("defineStore()");
  
  // 此处对三种创建方式进行兼容处理
  const isSetupStore = typeof setup === 'function'
  if (typeof idOrOptions === 'string') {
    id = idOrOptions
    // the option store setup will contain the actual options in this case
    options = isSetupStore ? setupOptions : setup
  } else {
    options = idOrOptions
    id = idOrOptions.id
  }

  function useStore(pinia?: Pinia | null, hot?: StoreGeneric): StoreGeneric {
    Log("useStore()");

    // 获取当前 vue 实例
    const currentInstance = getCurrentInstance()
    pinia =
      // 在 test 模式下，忽略提供的参数，因为我们总是可以通过 getActivePinia() 获取 pinia 实例
      // 如果 是test模式 && activePinia不为空 && activePinia是test模式 则为空 否则 返回参数中的pinia
      // 或者 如果获取到了当前实例 并且 存在piniaSymbol 返回 inject(piniaSymbol, null) 否则 返回空
      (__TEST__ && activePinia && activePinia._testing ? null : pinia) ||
      // 这里的 inject(piniaSymbol) 是在 createPinia 的 install 中 app.provide(piniaSymbol, pinia);
      (currentInstance && inject(piniaSymbol, null))
    
    // console.log("pinia 实例 ==>", pinia)
    
    // 将当前 pinia 实例设置为激活的 pinia
    // 如果存在多个 pinia 实例，方便后续逻辑获取当前pinia实例
    if (pinia) setActivePinia(pinia)

    // 在 dev环境 并且 获取不到当前 pinia 实例，则说明未全局注册，抛出错误
    if (__DEV__ && !activePinia) {
      throw new Error(
        `[🍍]: getActivePinia was called with no active Pinia. Did you forget to install pinia?\n` +
          `\tconst pinia = createPinia()\n` +
          `\tapp.use(pinia)\n` +
          `This will fail in production.`
      )
    }

    // 将激活的 pinia 实例赋值给 pinia 变量，确保 pinia === activePinia。防止 setActivePinia 出错导致两个变量不一致
    pinia = activePinia!

    // 如果 pinia 的 store 缓存中没有当前的 id，则创建新的 store，
    // 否则直接获取缓存中 store。
    if (!pinia._s.has(id)) {
      // 创建 store 并将其注册在 pinia._s 中
      if (isSetupStore) {
        // 组合式
        createSetupStore(id, setup, options, pinia)
      } else {
        // 选项式
        createOptionsStore(id, options as any, pinia)
      }

      /* istanbul ignore else */
      if (__DEV__) {
        // @ts-expect-error: not the right inferred type
        useStore._pinia = pinia
      }
    }

    // 获取 pinia 缓存中的 store
    const store: StoreGeneric = pinia._s.get(id)!

    // 开发环境 并且 是热更新
    if (__DEV__ && hot) {
      const hotId = '__hot:' + id
      const newStore = isSetupStore
        ? createSetupStore(hotId, setup, options, pinia, true)
        : createOptionsStore(hotId, assign({}, options) as any, pinia, true)

      hot._hotUpdate(newStore)

      // cleanup the state properties and the store from the cache
      delete pinia.state.value[hotId]
      pinia._s.delete(hotId)
    }

    // save stores in instances to access them devtools
    if (
      __DEV__ &&
      IS_CLIENT &&
      currentInstance &&
      currentInstance.proxy &&
      // avoid adding stores that are just built for hot module replacement
      !hot
    ) {
      const vm = currentInstance.proxy
      const cache = '_pStores' in vm ? vm._pStores! : (vm._pStores = {})
      cache[id] = store
    }

    // StoreGeneric cannot be casted towards Store
    return store as any
  }

  useStore.$id = id;

  // 将 useStore 函数返回出去，但不会立即调用，在组件内使用 store 时才会调用。
  // 所以在 defineStore 中只是做了些兼容逻辑，然后返回一个函数，返回的这个函数真正调用时才会触发更多逻辑。
  return useStore;
}
