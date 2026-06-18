// 烟花粒子背景动画：Canvas 驱动的真实物理烟花效果
// 核心：粒子以流光拖尾（streak/彗尾）渲染，非圆点；加法混合模拟真实光叠加
// 坐标系统：画布 Y 轴翻转后，y=0 为底部，y=h 为顶部，重力方向为 -Y
import React, { useRef, useEffect, useCallback } from 'react';

// ---- 烟花色盘（真实烟花常见色系）----
const PALETTES = [
  { name: '金橙',   colors: ['#FFD700','#FFA500','#FFEC8B','#FFC125'], core: '#FFFEF0' },
  { name: '赤红',   colors: ['#FF2400','#DC143C','#FF4444','#FF6B4A'], core: '#FFFFFF' },
  { name: '红金',   colors: ['#FF6B6B','#FF3B3B','#FFD93D','#FFAAAA'], core: '#FFFFFF' },
  { name: '桃红',   colors: ['#FF69B4','#FF1493','#FFB6C1','#FF85A2'], core: '#FFF0F5' },
  { name: '玫紫',   colors: ['#FDA7DF','#FF69B4','#DDA0DD','#FFB6C1'], core: '#FFF0F5' },
  { name: '紫罗兰', colors: ['#8B5CF6','#A78BFA','#C084FC','#7C3AED'], core: '#EDE9FE' },
  { name: '冷蓝',   colors: ['#4ECDC4','#70A1FF','#A29BFE','#7BED9F'], core: '#E8F8FF' },
  { name: '青蓝',   colors: ['#00FFFF','#00BFFF','#1E90FF','#87CEEB'], core: '#F0FFFF' },
  { name: '蓝金',   colors: ['#00D2FF','#3A7BD5','#FFD700','#87CEEB'], core: '#FFFFFF' },
  { name: '翠绿',   colors: ['#7FFF00','#00FA9A','#ADFF2F','#32CD32'], core: '#F0FFF0' },
  { name: '银白',   colors: ['#E8E8E8','#C0C0C0','#FFFFFF','#F5F5F5'], core: '#FFFFFF' },
  { name: '香槟',   colors: ['#E8D5B7','#D4AF37','#F0E6D3','#C9A96E'], core: '#FFFEFA' },
];

const BURST_TYPES = ['peony', 'willow', 'chrysanthemum', 'ring', 'palm', 'strobe'];

// ==================================================================
//  流光粒子 — 以彗尾/拖尾线条渲染，不是圆点
// ==================================================================
class StreakParticle {
  /**
   * @param {number} x,y      - 当前位置
   * @param {number} vx,vy    - 速度
   * @param {string} color    - CSS 颜色
   * @param {number} size     - 粒子粗细基数
   * @param {object}  opts    - gravity/friction/decay/trailLen/isCore 等
   */
  constructor(x, y, vx, vy, color, size, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.opacity = 1;
    this.gravity   = opts.gravity   ?? 0.022;
    this.friction  = opts.friction  ?? 0.987;
    this.decay     = opts.decay     ?? 0.006;
    this.trailLen  = opts.trailLen  ?? 6;
    this.isCore    = opts.isCore    ?? false;  // 核心粒子 → 更亮更白
    // 位置历史 (用于绘制折线拖尾)
    this.history = [{ x, y }];
  }

  update() {
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy -= this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.opacity -= this.decay;
    // 记录位置
    this.history.push({ x: this.x, y: this.y });
    if (this.history.length > this.trailLen) this.history.shift();
  }

  draw(ctx) {
    const pts = this.history;
    if (pts.length < 2) return;

    // ── 拖尾折线（从旧→新，渐变增亮） ──
    ctx.save();
    for (let i = 0; i < pts.length - 1; i++) {
      const t = (i + 1) / pts.length;              // 0→1 从尾到头
      const pw = this.size * (0.35 + t * 0.65);    // 头部更粗
      const alpha = this.opacity * (0.08 + t * 0.92);

      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.lineWidth = Math.max(0.2, pw);
      ctx.strokeStyle = this.color;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.lineCap = 'round';
      ctx.stroke();

      // 头部额外高亮
      if (t > 0.75 && this.opacity > 0.15) {
        ctx.beginPath();
        ctx.arc(pts[i + 1].x, pts[i + 1].y, pw * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = this.isCore ? '#FFFFFF' : this.color;
        ctx.globalAlpha = Math.max(0, this.opacity * (0.3 + t * 0.7));
        ctx.fill();
      }
    }
    ctx.restore();
  }

  get isDead() {
    return this.opacity <= 0.006 || this.y < -50 || this.x < -60;
  }
}

// ==================================================================
//  中心爆闪 — 星芒状闪光，非圆形
// ==================================================================
class StarBurst {
  constructor(x, y, intensity) {
    this.x = x;
    this.y = y;
    this.intensity = intensity; // 0~1
    this.alive = true;
    this.rays = 8 + Math.floor(Math.random() * 8);
    this.angles = Array.from({ length: this.rays }, () => Math.random() * Math.PI * 2);
    this.lengths = Array.from({ length: this.rays }, () => 8 + Math.random() * 25 * intensity);
  }

  update() {
    this.intensity -= 0.06;
    if (this.intensity <= 0) this.alive = false;
  }

  draw(ctx) {
    if (!this.alive) return;
    ctx.save();
    for (let i = 0; i < this.rays; i++) {
      const a = this.angles[i];
      const len = this.lengths[i] * this.intensity;
      const cx = this.x + Math.cos(a) * len;
      const cy = this.y + Math.sin(a) * len;

      // 主光线
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = (1.5 + Math.random() * 0.8) * this.intensity;
      ctx.globalAlpha = this.intensity * 0.8;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 光线末梢微光点
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5 * this.intensity, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFEF0';
      ctx.globalAlpha = this.intensity * 0.5;
      ctx.fill();
    }
    // 中心极小亮核
    ctx.beginPath();
    ctx.arc(this.x, this.y, 2 * this.intensity, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = this.intensity;
    ctx.fill();
    ctx.restore();
  }
}

// ==================================================================
//  火箭 — 非直线轨迹 + 真实烟花爆炸
// ==================================================================
class Rocket {
  constructor(x, targetY, palette, burstType, w, h) {
    this.x = x;
    this.y = 0;
    this.targetY = targetY;
    this.palette = palette;
    this.burstType = burstType;
    this.canvasW = w;
    this.canvasH = h;

    // ── 非直线轨迹：初始方向角 + 持续曲率 ──
    this.baseAngle = (Math.PI / 2) + (Math.random() - 0.5) * 0.35; // 70°~110° 略微偏斜
    this.speed = 4.5 + Math.random() * 4;
    this.vx0 = Math.cos(this.baseAngle) * this.speed * 0.15;       // 水平速度很小
    this.vy0 = Math.sin(this.baseAngle) * this.speed;
    // 曲率：每帧水平速度微调
    this.curvature = (Math.random() - 0.5) * 0.025;                // 轨迹弧度
    this.wobbleAmp = 0.3 + Math.random() * 0.7;                   // 正弦摆动幅度
    this.wobbleFreq = 0.04 + Math.random() * 0.06;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.age = 0;

    this.exploded = false;
    this.particles = [];
    this.starBursts = [];
    this.alive = true;

    // 尾焰火花（小块）
    this.sparks = [];
  }

  update() {
    this.age++;
    if (!this.exploded) {
      // ── 非直线上升：曲率 + 正弦摆动 ──
      const curveVx = this.vx0 + this.curvature * this.age;
      const wobbleVx = Math.sin(this.wobblePhase + this.wobbleFreq * this.age) * this.wobbleAmp;
      this.x += curveVx + wobbleVx;
      this.y += this.vy0;
      this.vy0 *= 0.9995; // 微减速

      // ── 上升尾焰火花（不规则）──
      if (Math.random() < 0.7) {
        this.sparks.push({
          x: this.x + (Math.random() - 0.5) * 3.5,
          y: this.y - (1.5 + Math.random() * 3),
          vx: (Math.random() - 0.5) * 0.4,
          vy: -Math.random() * 1.2,
          life: 0.55 + Math.random() * 0.45,
          size: 1 + Math.random() * 2,
        });
      }
      // 侧向飞溅
      if (Math.random() < 0.25) {
        this.sparks.push({
          x: this.x + (Math.random() - 0.5) * 6,
          y: this.y - Math.random() * 2,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 2,
          life: 0.35 + Math.random() * 0.4,
          size: 0.8 + Math.random() * 1.4,
        });
      }

      if (this.y >= this.targetY) this.explode();
    } else {
      for (const p of this.particles) p.update();
      for (const s of this.starBursts) s.update();
      this.particles = this.particles.filter(p => !p.isDead);
      this.starBursts = this.starBursts.filter(s => s.alive);

      // palm 子火花
      if (this.burstType === 'palm' && this.age > 18 && this.age < 50 && this.age % 3 === 0) {
        this.spawnPalmSparks();
      }

      if (this.particles.length === 0 && this.starBursts.length === 0) {
        this.alive = false;
      }
    }

    // 火花衰减
    for (const s of this.sparks) { s.life -= 0.025; s.x += s.vx; s.y += s.vy; }
    this.sparks = this.sparks.filter(s => s.life > 0);
  }

  // ============== 6 种爆炸生成器 ==============

  explode() {
    this.exploded = true;
    this.starBursts.push(new StarBurst(this.x, this.y, 0.85 + Math.random() * 0.15));
    this.age = 0;

    switch (this.burstType) {
      case 'peony':          this.explodePeony(); break;
      case 'willow':         this.explodeWillow(); break;
      case 'chrysanthemum':  this.explodeChrysanthemum(); break;
      case 'ring':           this.explodeRing(); break;
      case 'palm':           this.explodePalm(); break;
      case 'strobe':         this.explodeStrobe(); break;
      default:               this.explodePeony();
    }
  }

  // ── 牡丹：经典球形，外快内慢两层 ──
  explodePeony() {
    const { colors, core } = this.palette;
    const total = 120 + Math.floor(Math.random() * 45);

    // 外壳层
    const outer = Math.floor(total * 0.6);
    for (let i = 0; i < outer; i++) {
      const theta = (Math.PI * 2 * i) / outer + (Math.random() - 0.5) * 0.22;
      const speed = 1.0 + Math.random() * 1.5;
      const vx = Math.cos(theta) * speed;
      const vy = Math.sin(theta) * speed;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        colors[Math.floor(Math.random() * colors.length)],
        1.0 + Math.random() * 1.5,
        { gravity: 0.018, friction: 0.988, decay: 0.010, trailLen: 5 }));
    }

    // 内层慢速高亮
    const inner = total - outer;
    for (let i = 0; i < inner; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * 0.8;
      const vx = Math.cos(theta) * speed;
      const vy = Math.sin(theta) * speed;
      const isCore = i < inner * 0.3;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        isCore ? core : colors[Math.floor(Math.random() * colors.length)],
        1.4 + Math.random() * 2,
        { gravity: 0.012, friction: 0.992, decay: 0.008, trailLen: 4, isCore }));
    }
  }

  // ── 垂柳：上方扇形喷出，强重力拉弧 ──
  explodeWillow() {
    const wColors = ['#FFD700','#FFA500','#FFC125','#FFEC8B','#FFFFFF'];
    const count = 80 + Math.floor(Math.random() * 35);
    for (let i = 0; i < count; i++) {
      const theta = (Math.PI / 2) + (Math.random() - 0.5) * 1.2; // 30°~150°
      const speed = 1.0 + Math.random() * 1.6;
      const vx = Math.cos(theta) * speed;
      const vy = Math.sin(theta) * speed;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        wColors[Math.floor(Math.random() * wColors.length)],
        0.7 + Math.random() * 1.1,
        { gravity: 0.035, friction: 0.993, decay: 0.004, trailLen: 10 }));
    }
    // 顶部雾状光点
    for (let i = 0; i < 20; i++) {
      const theta = (Math.PI / 2) + (Math.random() - 0.5) * 0.5;
      const speed = 0.2 + Math.random() * 0.5;
      this.particles.push(new StreakParticle(this.x, this.y,
        Math.cos(theta) * speed, Math.sin(theta) * speed,
        '#FFFFFF', 1 + Math.random() * 1.6,
        { gravity: 0.008, decay: 0.012, trailLen: 3, isCore: true }));
    }
  }

  // ── 菊花：密集放射 + 每粒长尾 ──
  explodeChrysanthemum() {
    const { colors, core } = this.palette;
    const count = 150 + Math.floor(Math.random() * 45);
    for (let i = 0; i < count; i++) {
      const theta = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.18;
      const speed = 1.2 + Math.random() * 1.8;
      const vx = Math.cos(theta) * speed;
      const vy = Math.sin(theta) * speed;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        colors[Math.floor(Math.random() * colors.length)],
        0.7 + Math.random() * 1.2,
        { gravity: 0.014, friction: 0.989, decay: 0.007, trailLen: 7 }));
    }
    // 密集白色核心
    for (let i = 0; i < 35; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = 0.1 + Math.random() * 0.4;
      this.particles.push(new StreakParticle(this.x, this.y,
        Math.cos(theta) * speed, Math.sin(theta) * speed,
        core, 2 + Math.random() * 2.5,
        { gravity: 0.006, decay: 0.015, trailLen: 3, isCore: true }));
    }
  }

  // ── 光环：粒子束在窄纬度带，缓慢扩展 ──
  explodeRing() {
    const { colors, core } = this.palette;
    const count = 110 + Math.floor(Math.random() * 35);
    const ringTilt = (Math.random() - 0.5) * 0.5;
    for (let i = 0; i < count; i++) {
      const azi = (Math.PI * 2 * i) / count;       // 方位角
      const elev = ringTilt + (Math.random() - 0.5) * 0.2; // 纬度窄带
      const speed = 1.2 + Math.random() * 1.6;
      const vx = Math.cos(azi) * Math.cos(elev) * speed;
      const vy = Math.sin(elev) * speed;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        colors[Math.floor(Math.random() * colors.length)],
        0.8 + Math.random() * 1.3,
        { gravity: 0.008, decay: 0.009, trailLen: 5 }));
    }
    // 延迟爆心（30 帧后）
    this._ringCenterPending = true;
  }

  // ── 棕榈：主干粒子向上，带强尾迹 ──
  explodePalm() {
    const branchColors = ['#FFD700','#FFA500','#FF8C00','#FFC125','#FFFFFF'];
    const nb = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < nb; i++) {
      const theta = (Math.PI / 2) + (Math.random() - 0.5) * 0.8;
      const speed = 1.2 + Math.random() * 1.4;
      const vx = Math.cos(theta) * speed;
      const vy = Math.sin(theta) * speed;
      this.particles.push(new StreakParticle(this.x, this.y, vx, vy,
        branchColors[Math.floor(Math.random() * branchColors.length)],
        2.2 + Math.random() * 1.8,
        { gravity: 0.020, friction: 0.993, decay: 0.005, trailLen: 10, isCore: true }));
    }
  }

  spawnPalmSparks() {
    const bigs = this.particles.filter(p => p.opacity > 0.45 && p.size > 1.5);
    for (const b of bigs.slice(0, 5)) {
      for (let i = 0; i < 8; i++) {
        const theta = Math.random() * Math.PI * 2;
        const speed = 0.1 + Math.random() * 0.3;
        this.particles.push(new StreakParticle(b.x, b.y,
          Math.cos(theta) * speed, Math.sin(theta) * speed,
          '#FFFEF0', 0.3 + Math.random() * 0.6,
          { gravity: 0.028, decay: 0.025, trailLen: 2, isCore: true }));
      }
    }
  }

  // ── 频闪：多组错帧小爆裂 ──
  explodeStrobe() {
    const colors = ['#FFFFFF','#FFFEF0','#FFD700','#FFEC8B'];
    const bursts = 4 + Math.floor(Math.random() * 4);
    for (let b = 0; b < bursts; b++) {
      const bx = this.x + (Math.random() - 0.5) * 35;
      const by = this.y + (Math.random() - 0.5) * 25;
      const count = 28 + Math.floor(Math.random() * 20);
      const delay = b * 10;
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.9;
        const vx = Math.cos(theta) * speed;
        const vy = Math.sin(theta) * speed;
        const p = new StreakParticle(bx, by, vx, vy,
          colors[Math.floor(Math.random() * colors.length)],
          0.6 + Math.random() * 1.6,
          { gravity: 0.005, decay: 0.022, trailLen: 3, isCore: true });
        // 延迟可见
        p._hideFrames = delay;
        const origUpd = p.update.bind(p);
        p.update = function () {
          if (this._hideFrames > 0) { this._hideFrames--; this.opacity = 0.005; return; }
          if (this._hideFrames === 0) { this._hideFrames = -1; this.opacity = 0.85; }
          origUpd();
        };
        this.particles.push(p);
      }
    }
  }

  // ============== 绘制 ==============

  draw(ctx) {
    // ── 上升尾焰火花 ──
    ctx.save();
    for (const s of this.sparks) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = s.life;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FF8C00';
      ctx.globalAlpha = s.life * 0.13;
      ctx.fill();
    }
    ctx.restore();

    // ── 火箭本体（小光核 + 光晕）──
    if (!this.exploded) {
      ctx.save();
      // 外层光晕
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = 0.3;
      ctx.fill();
      // 内层亮核
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.restore();
    }

    // ── 中心星芒 ──
    for (const s of this.starBursts) s.draw(ctx);

    // ── 粒子（加法混合）──
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // 光叠加 → 更真实的烟花摄影效果
    for (const p of this.particles) p.draw(ctx);
    ctx.restore();
  }

  // 光环延迟爆心
  get needsRingCenter() { return this._ringCenterPending && this.age > 28; }
  doRingCenter() {
    this._ringCenterPending = false;
    const { core } = this.palette;
    for (let i = 0; i < 55; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = 0.2 + Math.random() * 1.2;
      this.particles.push(new StreakParticle(this.x, this.y,
        Math.cos(theta) * speed, Math.sin(theta) * speed,
        core, 1 + Math.random() * 1.8,
        { gravity: 0.010, decay: 0.012, trailLen: 3, isCore: true }));
    }
    this.starBursts.push(new StarBurst(this.x, this.y, 0.7));
  }
}

// ==================================================================
//  React 组件
// ==================================================================
const FireworksBackground = ({
  density = 1.0,
  minInterval = 700,
  maxInterval = 2000,
}) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const rocketsRef = useRef([]);
  const lastLaunchRef = useRef(0);
  const dimsRef = useRef({ w: 0, h: 0 });
  const visibleRef = useRef(false); // IntersectionObserver 控制显隐
  const runningRef = useRef(false); // RAF 是否正在运行

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dimsRef.current = { w: rect.width, h: rect.height };
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    const t = setTimeout(resize, 700);
    return () => { window.removeEventListener('resize', resize); clearTimeout(t); };
  }, [resize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dims = dimsRef.current;
    if (dims.w === 0 || dims.h === 0) return;

    let running = true;
    runningRef.current = true;

    const stopLoop = () => {
      running = false;
      runningRef.current = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      runningRef.current = true;
      lastLaunchRef.current = performance.now();
      animRef.current = requestAnimationFrame(loop);
    };

    // 🔋 性能优化：IntersectionObserver 检测可见性，不可见时停止动画
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting && !runningRef.current) {
          startLoop();
        } else if (!entry.isIntersecting && runningRef.current) {
          stopLoop();
        }
      },
      { threshold: 0.01 }
    );
    observer.observe(canvas);

    // 🔋 性能优化：页面不可见时（切换标签页）暂停动画
    const handleVisibility = () => {
      if (document.hidden && runningRef.current) {
        stopLoop();
      } else if (!document.hidden && visibleRef.current && !runningRef.current) {
        startLoop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    lastLaunchRef.current = performance.now();

    const loop = (timestamp) => {
      if (!running) return;
      const { w, h } = dims;

      ctx.clearRect(0, 0, w, h);

      // ── 发射逻辑 ──
      const elapsed = timestamp - lastLaunchRef.current;
      const interval = (minInterval + Math.random() * (maxInterval - minInterval)) / density;
      if (elapsed > interval) {
        const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
        const burstType = BURST_TYPES[Math.floor(Math.random() * BURST_TYPES.length)];
        const x = w * 0.1 + Math.random() * w * 0.8;
        const targetY = h * 0.18 + Math.random() * h * 0.72;
        rocketsRef.current.push(new Rocket(x, targetY, palette, burstType, w, h));
        lastLaunchRef.current = timestamp;
      }

      if (rocketsRef.current.length > 6) rocketsRef.current = rocketsRef.current.slice(-6);

      // ── 坐标系翻转 ──
      ctx.save();
      ctx.translate(0, h);
      ctx.scale(1, -1);

      for (const rocket of rocketsRef.current) {
        rocket.update();
        rocket.draw(ctx);
        // ring 延迟爆心
        if (rocket.needsRingCenter) rocket.doRingCenter();
      }

      ctx.restore();

      rocketsRef.current = rocketsRef.current.filter(r => r.alive);
      animRef.current = requestAnimationFrame(loop);
    };

    const t0 = setTimeout(() => { animRef.current = requestAnimationFrame(loop); }, 400);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      stopLoop();
      clearTimeout(t0);
    };
  }, [density, minInterval, maxInterval]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
      aria-hidden="true"
    />
  );
};

export default FireworksBackground;
