import type { ComponentPublicInstance } from 'vue-demi'
import type {
  _GettersTree,
  _Method,
  StateTree,
  Store,
  StoreDefinition,
} from './types'

/**
 * Interface to allow customizing map helpers. Extend this interface with the
 * following properties:
 *
 * - `suffix`: string. Affects the suffix of `mapStores()`, defaults to `Store`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MapStoresCustomization {
  // cannot be added or it wouldn't be able to be extended
  // suffix?: string
}

/**
 * For internal use **only**.
 */
export type _StoreObject<S> = S extends StoreDefinition<
  infer Ids,
  infer State,
  infer Getters,
  infer Actions
>
  ? {
      [Id in `${Ids}${MapStoresCustomization extends Record<
        'suffix',
        infer Suffix
      >
        ? Suffix
        : 'Store'}`]: () => Store<
        Id extends `${infer RealId}${MapStoresCustomization extends Record<
          'suffix',
          infer Suffix
        >
          ? Suffix
          : 'Store'}`
          ? RealId
          : string,
        State,
        Getters,
        Actions
      >
    }
  : {}

/**
 * For internal use **only**.
 */
export type _Spread<A extends readonly any[]> = A extends [infer L, ...infer R]
  ? _StoreObject<L> & _Spread<R>
  : unknown

export let mapStoreSuffix = 'Store'

/**
 * Changes the suffix added by `mapStores()`. Can be set to an empty string.
 * Defaults to `"Store"`. Make sure to extend the MapStoresCustomization
 * interface if you are using TypeScript.
 *
 * @param suffix - new suffix
 */
export function setMapStoreSuffix(
  suffix: MapStoresCustomization extends Record<'suffix', infer Suffix>
    ? Suffix
    : string // could be 'Store' but that would be annoying for JS
): void {
  mapStoreSuffix = suffix
}

/**
 * 通过生成一个对象，传递到组件的 computed 字段 以允许在不使用组合式 API(setup())的情况下使用 store。 它接受一个 store 定义的列表参数。
 *
 * @example
 * ```js
 * export default {
 *   computed: {
 *     // other computed properties
 *     ...mapStores(useUserStore, useCartStore)
 *   },
 *
 *   created() {
 *     this.userStore // store with id "user"
 *     this.cartStore // store with id "cart"
 *   }
 * }
 * ```
 *
 * @param stores - 要映射到 object 的 stores 列表
 */
export function mapStores<Stores extends any[]>(
  // 所有参数放入 stores 数组，所以 store 不需要在包裹一层数组
  ...stores: [...Stores]
): _Spread<Stores> {
  // 直接将 store 通过参数传递即可，不需要放到数组中，如果放到了数组中就抛出警告
  if (__DEV__ && Array.isArray(stores[0])) {
    console.warn(
      `[🍍]: Directly pass all stores to "mapStores()" without putting them in an array:\n` +
        `Replace\n` +
        `\tmapStores([useAuthStore, useCartStore])\n` +
        `with\n` +
        `\tmapStores(useAuthStore, useCartStore)\n` +
        `This will fail in production if not fixed.`
    )
    stores = stores[0]
  }

  // 遍历所有传进来的 useStore 并执行，然后 return 出去就得到了所有的 store
  return stores.reduce((reduced, useStore) => {
    // $id 是 defineStore 添加的
    // @ts-expect-error: $id is added by defineStore
    reduced[useStore.$id + mapStoreSuffix] = function (
      this: ComponentPublicInstance
    ) {
      return useStore(this.$pinia)
    }
    return reduced
  }, {} as _Spread<Stores>)
}

/**
 * For internal use **only**
 */
export type _MapStateReturn<
  S extends StateTree,
  G extends _GettersTree<S>,
  Keys extends keyof S | keyof G = keyof S | keyof G
> = {
  // [key in keyof S | keyof G]: () => key extends keyof S
  //   ? S[key]
  //   : key extends keyof G
  //   ? G[key]
  //   : never
  [key in Keys]: () => Store<string, S, G, {}>[key]
}

/**
 * For internal use **only**
 */
export type _MapStateObjectReturn<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  T extends Record<
    string,
    keyof S | keyof G | ((store: Store<Id, S, G, A>) => any)
  > = {}
> = {
  [key in keyof T]: () => T[key] extends (store: any) => infer R
    ? R
    : T[key] extends keyof Store<Id, S, G, A>
    ? Store<Id, S, G, A>[T[key]]
    : never
}

/**
 * 通过生成一个对象，并传递至组件的 computed 字段， 以允许在不使用组合式 API(setup())的情况下使用一个 store 的 state 和 getter。 该对象的值是 state 属性/getter， 而键是生成的计算属性名称。 你也可以选择传递一个自定义函数，该函数将接收 store 作为其第一个参数。 注意，虽然它可以通过 this 访问组件实例，但它没有标注类型。
 *
 * @example
 * ```js
 * export default {
 *   computed: {
 *     // other computed properties
 *     // useCounterStore has a state property named `count` and a getter `double`
 *     ...mapState(useCounterStore, {
 *       n: 'count',
 *       triple: store => store.n * 3,
 *       // note we can't use an arrow function if we want to use `this`
 *       custom(store) {
 *         return this.someComponentValue + store.n
 *       },
 *       doubleN: 'double'
 *     })
 *   },
 *
 *   created() {
 *     this.n // 2
 *     this.doubleN // 4
 *   }
 * }
 * ```
 *
 * @param useStore - defineStore 中返回的 useStore
 * @param keyMapper - state 的属性名 或 getters 的对象
 */
export function mapState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  KeyMapper extends Record<
    string,
    keyof S | keyof G | ((store: Store<Id, S, G, A>) => any)
  >
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keyMapper: KeyMapper
): _MapStateObjectReturn<Id, S, G, A, KeyMapper>

/**
 * Allows using state and getters from one store without using the composition
 * API (`setup()`) by generating an object to be spread in the `computed` field
 * of a component.
 *
 * @example
 * ```js
 * export default {
 *   computed: {
 *     // other computed properties
 *     ...mapState(useCounterStore, ['count', 'double'])
 *   },
 *
 *   created() {
 *     this.count // 2
 *     this.double // 4
 *   }
 * }
 * ```
 *
 * @param useStore - defineStore 中返回的 useStore
 * @param keys - state 的属性名 或 getters 的数组
 */
export function mapState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  Keys extends keyof S | keyof G
>(
  useStore: StoreDefinition<Id, S, G, A>,
  // key数组，内容仅限于 State 和 Getter 的 key
  keys: readonly Keys[]
): _MapStateReturn<S, G, Keys>

/**
 * Allows using state and getters from one store without using the composition
 * API (`setup()`) by generating an object to be spread in the `computed` field
 * of a component.
 *
 * @param useStore - defineStore 中返回的 useStore
 * @param keysOrMapper - array or object
 */
export function mapState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keysOrMapper: any
): _MapStateReturn<S, G> | _MapStateObjectReturn<Id, S, G, A> {
  // 此处逻辑和 mapAction 很像
  return Array.isArray(keysOrMapper)
    ? keysOrMapper.reduce((reduced, key) => {
        reduced[key] = function (this: ComponentPublicInstance) {
          // 和 mapAction 的区别：mapAction 取出的是经过 wrapAction 的 action ，然后在这调用了一下
          return useStore(this.$pinia)[key]
        } as () => any
        return reduced
      }, {} as _MapStateReturn<S, G>)
    : Object.keys(keysOrMapper).reduce((reduced, key: string) => {
        // @ts-expect-error
        reduced[key] = function (this: ComponentPublicInstance) {
          const store = useStore(this.$pinia)
          const storeKey = keysOrMapper[key]
          // 由于某种原因，TS 无法将 storeKey 的类型推断为函数
          return typeof storeKey === 'function'
            ? (storeKey as (store: Store<Id, S, G, A>) => any).call(this, store)
            : store[storeKey]
        }
        return reduced
      }, {} as _MapStateObjectReturn<Id, S, G, A>)
}

/**
 * Alias for `mapState()`. You should use `mapState()` instead.
 * @deprecated use `mapState()` instead.
 */
export const mapGetters = mapState

/**
 * For internal use **only**
 */
export type _MapActionsReturn<A> = {
  [key in keyof A]: A[key]
}

/**
 * For internal use **only**
 */
export type _MapActionsObjectReturn<A, T extends Record<string, keyof A>> = {
  [key in keyof T]: A[T[key]]
}

/**
 * 这个方法需要传入 useStore 和一个对象，可以在导入过程中给 action 改名，对象 key 为 action 的新名字，value 为 action 的旧名字
 * 通过生成一个传递到组件的 methods 字段的对象， 允许直接使用 store 的 action，而不需要使用组合式 API(setup())。 该对象的值是 action， 而键是产生的方法名称。
 *
 * @example
 * ```js
 * export default {
 *   methods: {
 *     // other methods properties
 *     // useCounterStore has two actions named `increment` and `setCount`
 *     ...mapActions(useCounterStore, { moar: 'increment', setIt: 'setCount' })
 *   },
 *
 *   created() {
 *     this.moar()
 *     this.setIt(2)
 *   }
 * }
 * ```
 *
 * @param useStore - defineStore 返回的 useStore
 * @param keyMapper - 为 action 定义新名称的对象
 */
export function mapActions<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  KeyMapper extends Record<string, keyof A>
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keyMapper: KeyMapper
): _MapActionsObjectReturn<A, KeyMapper>
/**
 * 这个方法需要传入 useStore 和一个数组，数组内容为需要导入的 action 名称
 * 通过生成一个传递到组件的 methods 字段的对象， 允许直接使用 store 的 action，而不需要使用组合式 API(setup())。 该对象的值是 action， 而键是产生的方法名称。
 *
 * @example
 * ```js
 * export default {
 *   methods: {
 *     // other methods properties
 *     ...mapActions(useCounterStore, ['increment', 'setCount'])
 *   },
 *
 *   created() {
 *     this.increment()
 *     this.setCount(2) // pass arguments as usual
 *   }
 * }
 * ```
 *
 * @param useStore - defineStore 返回的 useStore
 * @param keys - 要映射的 action 名称数组
 */
export function mapActions<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keys: Array<keyof A>
): _MapActionsReturn<A>
/**
 * 通过生成一个传递到组件的 methods 字段的对象， 允许直接使用 store 的 action，而不需要使用组合式 API(setup())。 该对象的值是 action， 而键是产生的方法名称。
 *
 * @param useStore - defineStore 返回的 useStore
 * @param keysOrMapper - array or object
 */
export function mapActions<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  KeyMapper extends Record<string, keyof A>
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keysOrMapper: Array<keyof A> | KeyMapper
): _MapActionsReturn<A> | _MapActionsObjectReturn<A, KeyMapper> {
  return Array.isArray(keysOrMapper)
    // 如果传入的是数组，遍历这个数组取出所有 action 名称
    ? keysOrMapper.reduce((reduced, key) => {
        // @ts-expect-error
        reduced[key] = function (
          // 如果组件的具体类型无法获得，或者你并不关心组件的具体类型，那么可以使用 ComponentPublicInstance
          this: ComponentPublicInstance,
          ...args: any[]
        ) {
          return useStore(this.$pinia)[key](...args)
        }
        return reduced
      }, {} as _MapActionsReturn<A>)
    // 如果传入的是对象，keysOrMapper[key] 值为 action 名称
    : Object.keys(keysOrMapper).reduce((reduced, key: keyof KeyMapper) => {
        // key 为新 name 
        // @ts-expect-error
        reduced[key] = function (
          this: ComponentPublicInstance,
          ...args: any[]
        ) {
          return useStore(this.$pinia)[keysOrMapper[key]](...args)
        }
        return reduced
      }, {} as _MapActionsObjectReturn<A, KeyMapper>)
}

/**
 * For internal use **only**
 */
export type _MapWritableStateReturn<S extends StateTree> = {
  [key in keyof S]: {
    get: () => S[key]
    set: (value: S[key]) => any
  }
}

/**
 * For internal use **only**
 */
export type _MapWritableStateObjectReturn<
  S extends StateTree,
  T extends Record<string, keyof S>
> = {
  [key in keyof T]: {
    get: () => S[T[key]]
    set: (value: S[T[key]]) => any
  }
}

/**
 * 除了创建的计算属性的 setter，其他与 mapState() 相同， 所以 state 可以被修改。 与 mapState() 不同的是，只有 state 属性可以被添加。
 *
 * @param useStore - store to map from
 * @param keyMapper - object of state properties
 */
export function mapWritableState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  KeyMapper extends Record<string, keyof S>
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keyMapper: KeyMapper
): _MapWritableStateObjectReturn<S, KeyMapper>
/**
 * Allows using state and getters from one store without using the composition
 * API (`setup()`) by generating an object to be spread in the `computed` field
 * of a component.
 *
 * @param useStore - store to map from
 * @param keys - array of state properties
 */
export function mapWritableState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  Keys extends keyof S
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keys: readonly Keys[]
): {
  [K in Keys]: {
    get: () => S[K]
    set: (value: S[K]) => any
  }
}
/**
 * Allows using state and getters from one store without using the composition
 * API (`setup()`) by generating an object to be spread in the `computed` field
 * of a component.
 *
 * @param useStore - store to map from
 * @param keysOrMapper - array or object
 */
export function mapWritableState<
  Id extends string,
  S extends StateTree,
  G extends _GettersTree<S>,
  A,
  KeyMapper extends Record<string, keyof S>
>(
  useStore: StoreDefinition<Id, S, G, A>,
  keysOrMapper: Array<keyof S> | KeyMapper
): _MapWritableStateReturn<S> | _MapWritableStateObjectReturn<S, KeyMapper> {
  // 也是对于数组和对象的分别处理
  // 返回包含 get 和 set 函数的对象，交给 computed 处理
  return Array.isArray(keysOrMapper)
    ? keysOrMapper.reduce((reduced, key) => {
        // @ts-ignore
        reduced[key] = {
          get(this: ComponentPublicInstance) {
            return useStore(this.$pinia)[key]
          },
          set(this: ComponentPublicInstance, value) {
            // it's easier to type it here as any
            return (useStore(this.$pinia)[key] = value as any)
          },
        }
        return reduced
      }, {} as _MapWritableStateReturn<S>)
    : Object.keys(keysOrMapper).reduce((reduced, key: keyof KeyMapper) => {
        // @ts-ignore
        reduced[key] = {
          get(this: ComponentPublicInstance) {
            return useStore(this.$pinia)[keysOrMapper[key]]
          },
          set(this: ComponentPublicInstance, value) {
            // it's easier to type it here as any
            return (useStore(this.$pinia)[keysOrMapper[key]] = value as any)
          },
        }
        console.log(reduced)
        return reduced
      }, {} as _MapWritableStateObjectReturn<S, KeyMapper>)
}
