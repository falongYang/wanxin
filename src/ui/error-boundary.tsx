// 全站崩溃兜底：渲染层任何未捕获错误落到安静的夜航提示，而不是白屏。
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 静默留存到 console，便于真机排查；不外发任何数据。
    console.error('ui_crash', error?.message, info?.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <div className="crash-fallback" role="alert">
      <p className="crash-moon" aria-hidden="true">☾</p>
      <h1>信号飘远了一会儿</h1>
      <p className="crash-text">今晚的海面起了点雾，页面暂时找不着北。<br />刷新一下，电台的灯还亮着。</p>
      <button type="button" onClick={() => window.location.reload()}>回到晚信</button>
    </div>
  }
}
