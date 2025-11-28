import React, { useState, useEffect, useId, useMemo } from "react";
import { createRoot } from "react-dom/client";

// --- 样式注入 ---
const styleId = "signature-player-styles";
if (!document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = `
    .signature-svg { width: 100%; height: 100%; overflow: visible; display: block; } 
    @keyframes dash { to { stroke-dashoffset: 0; } }
    @keyframes undash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: var(--seg-len); } }
  `;
  document.head.appendChild(style);
}

// --- 默认配置 ---
const DEFAULT_CONFIG = {
  loop: true,       // 是否循环播放
  duration: 1000,   // 单笔画耗时 (ms)
  delay: 100,       // 笔画间停顿 (ms)
  loopDelay: 2000,  // 写完后停留多久开始擦除 (ms)
  eraseDelay: 500,  // 擦除完停留多久开始重写 (ms)
};

const AnimatedPath = ({ d, color, index, currentStep, direction, recordedStrokeData, config }) => {
  const [segments, setSegments] = useState([]);
  const maskId = useId();
  
  const isCompleted = index < currentStep;
  const isWaiting = index > currentStep;
  const isCurrent = index === currentStep;
  
  useEffect(() => {
    if (!recordedStrokeData) {
      setSegments([]);
      return;
    }

    const raw = recordedStrokeData.rawStrokes && recordedStrokeData.rawStrokes.length > 0
       ? recordedStrokeData.rawStrokes 
       : [{ d: recordedStrokeData.d, width: recordedStrokeData.width }];
    
    const measured = raw.map(s => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", s.d);
      return { d: s.d, width: s.width || recordedStrokeData.width || 12, len: el.getTotalLength() };
    });

    const totalLen = measured.reduce((sum, s) => sum + s.len, 0);
    let accumulatedDelay = 0;
    
    setSegments(measured.map(s => {
      const segDuration = totalLen > 0 ? (s.len / totalLen) * config.duration : 0;
      const delay = accumulatedDelay;
      accumulatedDelay += segDuration;
      return { ...s, duration: segDuration, delay };
    }));
  }, [recordedStrokeData, config.duration]);

  // 无录制数据时的简单回退模式
  if (!recordedStrokeData || segments.length === 0) {
    let opacity = 0;
    if (isCompleted) opacity = 1;
    else if (isCurrent && direction === 1) opacity = 1;
    
    return React.createElement("path", {
      d: d,
      fill: color || "#000",
      style: { opacity, transition: `opacity ${config.duration}ms` },
    });
  }

  // Mask 动画生成
  const maskContent = segments.map((seg, i) => {
    let dashOffset;
    let animation = "none";

    if (isCompleted) {
      dashOffset = 0;
    } else if (isWaiting) {
      dashOffset = seg.len;
    } else {
      if (direction === 1) {
        // 书写模式
        dashOffset = seg.len;
        animation = `dash ${seg.duration}ms linear forwards ${seg.delay}ms`;
      } else {
        // 擦除模式 (倒带)
        // 倒算延迟：总时长 - (当前段开始时间 + 当前段持续时间)
        const reverseDelay = config.duration - (seg.delay + seg.duration);
        dashOffset = 0; 
        animation = `undash ${seg.duration}ms linear forwards ${reverseDelay}ms`;
      }
    }

    return React.createElement("path", {
      key: i,
      d: seg.d,
      stroke: "white",
      strokeWidth: seg.width,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      fill: "none",
      strokeDasharray: seg.len,
      strokeDashoffset: dashOffset,
      style: { animation, "--seg-len": seg.len } 
    });
  });

  return React.createElement("g", null,
    React.createElement("defs", null,
      React.createElement("mask", { id: maskId, maskUnits: "userSpaceOnUse" }, maskContent)
    ),
    React.createElement("path", { 
      d: d, 
      fill: color || "#000", 
      mask: `url(#${maskId})`,
      style: { opacity: isWaiting ? 0 : 1, transition: "opacity 0.2s" }
    })
  );
};

const SignaturePlayer = ({ jsonUrl, options = {} }) => {
  const [data, setData] = useState(null);
  const [step, setStep] = useState(-1);
  const [direction, setDirection] = useState(1); 

  const config = useMemo(() => ({ ...DEFAULT_CONFIG, ...options }), [options]);

  useEffect(() => {
    if (!jsonUrl) return;
    const controller = new AbortController();
    let startTimer;
    fetch(jsonUrl, { signal: controller.signal }).then((r) => r.json()).then((json) => {
        if (controller.signal.aborted) return;
        if (json.paths) {
          setData(json);
          startTimer = setTimeout(() => setStep(0), 500);
        }
      }).catch((e) => { if (e.name !== "AbortError") console.error(e); });
    return () => { controller.abort(); if (startTimer) clearTimeout(startTimer); };
  }, [jsonUrl]);

  useEffect(() => {
    if (!data) return;
    let timer;
    const total = data.paths.length;
    
    const nextTick = () => {
      if (direction === 1) {
        if (step < total - 1) {
          setStep((s) => s + 1);
        } else {
          if (config.loop) timer = setTimeout(() => setDirection(-1), config.loopDelay);
        }
      } else {
        if (step > 0) {
          setStep((s) => s - 1);
        } else {
          timer = setTimeout(() => setDirection(1), config.eraseDelay);
        }
      }
    };

    const interval = config.duration + config.delay;
    timer = setTimeout(nextTick, interval);
    return () => clearTimeout(timer);
  }, [step, direction, data, config]);

  if (!data) return null;

  return React.createElement(
    "svg",
    { className: "signature-svg", viewBox: data.svgInfo.viewBox, preserveAspectRatio: "xMidYMid meet" },
    data.paths.map((path, idx) =>
      React.createElement(AnimatedPath, {
        key: path.id,
        index: idx,
        currentStep: step,
        direction: direction,
        d: path.d,
        color: path.color,
        recordedStrokeData: data.recordedStrokes?.[path.id],
        config: config
      })
    )
  );
};

export function mountSignature(container, jsonUrl, options) {
  const dom = typeof container === "string" ? document.getElementById(container) : container;
  if (!dom) return;
  const root = createRoot(dom);
  root.render(React.createElement(SignaturePlayer, { jsonUrl, options }));
  return root;
}