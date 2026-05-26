import { useEffect, useRef } from 'react'
import { getTheme } from '@/lib/theme'

/**
 * Vanilla-canvas rotating "agent network" sphere. ~200 nodes laid out on a
 * Fibonacci sphere, each connected to its 5 nearest neighbours, auto-rotating
 * around Y with a soft mouse-parallax tilt. No deps, ~3KB of code.
 *
 * Visual goals:
 *   - feels like 'network of agents', supports the product narrative
 *   - restrained — single accent colour, depth via alpha, no neon
 *   - cheap — runs comfortably on 60fps with 200 nodes on a mid Macbook
 *
 * Respects prefers-reduced-motion (no animation, single static frame instead).
 */

const NODE_COUNT = 220
const NEIGHBOURS_PER_NODE = 4
const FOCAL = 600
const SPHERE_RADIUS = 220
const AUTO_ROTATE_Y_PER_SEC = 0.18
const PARALLAX_X_RAD = 0.35
const PARALLAX_Y_RAD = 0.25
const PARALLAX_LERP = 0.06
const PULSE_INTERVAL_MS = 2400

interface Point {
  x: number
  y: number
  z: number
  /** Indexes of neighbours in the same array. Computed once on init. */
  neighbours: number[]
  /** Random phase offset so pulses look organic, not in lockstep. */
  pulsePhase: number
}

function fibonacciSphere(n: number, r: number): Array<Omit<Point, 'neighbours' | 'pulsePhase'>> {
  const points: Array<Omit<Point, 'neighbours' | 'pulsePhase'>> = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = goldenAngle * i
    points.push({
      x: Math.cos(theta) * radiusAtY * r,
      y: y * r,
      z: Math.sin(theta) * radiusAtY * r,
    })
  }
  return points
}

function buildPoints(): Point[] {
  const raw = fibonacciSphere(NODE_COUNT, 1)
  const points: Point[] = raw.map(p => ({ ...p, neighbours: [], pulsePhase: Math.random() * Math.PI * 2 }))
  // Compute neighbours once — they don't change as we rotate.
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const dists: Array<{ idx: number; d: number }> = []
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue
      const b = points[j]!
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      dists.push({ idx: j, d: dx * dx + dy * dy + dz * dz })
    }
    dists.sort((p, q) => p.d - q.d)
    a.neighbours = dists.slice(0, NEIGHBOURS_PER_NODE).map(x => x.idx)
  }
  return points
}

/**
 * Colour palette per theme. Tuned so the sphere reads against either
 * --color-surface-1 (dark) or its light counterpart, without leaving the
 * Linear-purple brand language.
 */
function paletteForTheme(theme: 'dark' | 'light') {
  if (theme === 'light') {
    return {
      node: '94, 106, 210',
      line: '94, 106, 210',
      pulse: '107, 84, 200',
      bg: 'rgba(0, 0, 0, 0)',
      nodeAlpha: 0.85,
      lineAlpha: 0.32,
    }
  }
  return {
    node: '167, 139, 250',
    line: '94, 106, 210',
    pulse: '224, 213, 255',
    bg: 'rgba(0, 0, 0, 0)',
    nodeAlpha: 0.9,
    lineAlpha: 0.22,
  }
}

export function NetworkSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const points = buildPoints()
    let theme: 'dark' | 'light' = getTheme()
    let palette = paletteForTheme(theme)

    let raf = 0
    let width = 0
    let height = 0
    let dpr = window.devicePixelRatio || 1

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Rotation state. base = continuous auto-rotation, tilt = mouse parallax.
    let baseY = 0
    let targetTiltX = 0
    let targetTiltY = 0
    let currentTiltX = 0
    let currentTiltY = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
      targetTiltY = nx * PARALLAX_Y_RAD
      targetTiltX = -ny * PARALLAX_X_RAD
    }
    const onPointerLeave = () => {
      targetTiltX = 0
      targetTiltY = 0
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)

    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<'dark' | 'light'>).detail
      if (next === 'dark' || next === 'light') {
        theme = next
        palette = paletteForTheme(theme)
      }
    }
    document.addEventListener('agent-platform/theme-change', onThemeChange)

    let lastTs = performance.now()

    const draw = (ts: number) => {
      const dt = Math.min((ts - lastTs) / 1000, 0.05)
      lastTs = ts

      if (!reducedMotion) {
        baseY += AUTO_ROTATE_Y_PER_SEC * dt
        currentTiltX += (targetTiltX - currentTiltX) * PARALLAX_LERP
        currentTiltY += (targetTiltY - currentTiltY) * PARALLAX_LERP
      }

      const totalY = baseY + currentTiltY
      const totalX = currentTiltX

      const cosY = Math.cos(totalY)
      const sinY = Math.sin(totalY)
      const cosX = Math.cos(totalX)
      const sinX = Math.sin(totalX)

      // Project each point through Y then X rotation, then perspective divide.
      const cx = width / 2
      const cy = height / 2
      const scale = Math.min(width, height) / 700

      const projected: Array<{ x: number; y: number; z: number; depth: number }> = new Array(points.length)
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!
        // Y rotation
        const x1 = p.x * cosY - p.z * sinY
        const z1 = p.x * sinY + p.z * cosY
        // X rotation
        const y2 = p.y * cosX - z1 * sinX
        const z2 = p.y * sinX + z1 * cosX
        const x = x1 * SPHERE_RADIUS
        const y = y2 * SPHERE_RADIUS
        const z = z2 * SPHERE_RADIUS
        const f = FOCAL / (FOCAL - z)
        projected[i] = { x: cx + x * f * scale, y: cy + y * f * scale, z, depth: (z + SPHERE_RADIUS) / (2 * SPHERE_RADIUS) }
      }

      ctx.clearRect(0, 0, width, height)

      // Draw lines first so dots cover them at the join.
      for (let i = 0; i < points.length; i++) {
        const a = projected[i]!
        if (a.depth < 0.18) continue // skip back hemisphere edges for cleanliness
        for (const j of points[i]!.neighbours) {
          if (j < i) continue // each edge once
          const b = projected[j]!
          const depth = (a.depth + b.depth) / 2
          const alpha = palette.lineAlpha * depth * depth
          if (alpha < 0.02) continue
          ctx.strokeStyle = `rgba(${palette.line}, ${alpha.toFixed(3)})`
          ctx.lineWidth = 0.7 * depth
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // Draw nodes (with the occasional pulse for liveness).
      const tSec = ts / 1000
      for (let i = 0; i < points.length; i++) {
        const p = projected[i]!
        if (p.depth < 0.05) continue
        const radius = (1.4 + 1.8 * p.depth) * scale * 1.15
        // pulse: oscillation in [0, 1], peaks every ~PULSE_INTERVAL_MS
        const pulseT = (tSec * (1000 / PULSE_INTERVAL_MS) + points[i]!.pulsePhase) % 1
        const pulse = pulseT < 0.08 ? Math.sin((pulseT / 0.08) * Math.PI) : 0

        const baseAlpha = palette.nodeAlpha * (0.55 + 0.45 * p.depth)
        ctx.fillStyle = `rgba(${palette.node}, ${(baseAlpha + pulse * 0.6).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius + pulse * scale * 3.5, 0, Math.PI * 2)
        ctx.fill()

        if (pulse > 0.1) {
          ctx.fillStyle = `rgba(${palette.pulse}, ${(pulse * 0.5).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, radius + pulse * scale * 8, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    if (reducedMotion) {
      // single static frame
      draw(performance.now())
    } else {
      raf = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('agent-platform/theme-change', onThemeChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-auto"
      aria-hidden="true"
    />
  )
}
