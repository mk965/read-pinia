import { getCurrentScope, onScopeDispose } from 'vue-demi'
import { _Method } from './types'

export const noop = () => {}

/**
 * 添加订阅
 * @param subscriptions 订阅者数组
 * @param callback 回调
 * @param detached 
 * @param onCleanup 当清楚订阅时的回调
 * @returns 清除订阅的回调
 */
export function addSubscription<T extends _Method>(
  subscriptions: T[],
  callback: T,
  detached?: boolean,
  onCleanup: () => void = noop
) {
  subscriptions.push(callback)

  // 移除订阅
  const removeSubscription = () => {
    const idx = subscriptions.indexOf(callback)
    // 如果存在这个订阅，在订阅数组中移除掉，并执行回调
    if (idx > -1) {
      subscriptions.splice(idx, 1)
      // 执行移除订阅回调
      onCleanup()
    }
  }

  // detached 为 true 时，在当前作用于停止时，不会删除此订阅，为 false 时会移除此订阅
  // getCurrentScope 如果有的话，返回当前活跃的 effect 作用域
  if (!detached && getCurrentScope()) {
    // onScopeDispose: 在当前活跃的 effect 作用域上注册一个处理回调函数。当相关的 effect 作用域停止时会调用这个回调函数。
    onScopeDispose(removeSubscription)
  }

  // 返回移除订阅的函数
  return removeSubscription
}

/**
 * 触发订阅者回调
 * @param subscriptions 订阅数组
 * @param args 传给回调的参数
 */
export function triggerSubscriptions<T extends _Method>(
  subscriptions: T[],
  ...args: Parameters<T>
) {
  subscriptions.slice().forEach((callback) => {
    callback(...args)
  })
}
