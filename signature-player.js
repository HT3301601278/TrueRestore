import React, { useState, useEffect, useRef, useId, useMemo } from "react";
import { createRoot } from "react-dom/client";

// --- 样式注入 ---
const styleId = "signature-player-styles";
if (!document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = `.signature-svg { width: 100%; height: 100%; overflow: visible; display: block; }`;
  document.head.appendChild(style);
}

// --- 默认配置 ---
const DEFAULT_CONFIG = {
  loop: true,       // 是否循环播放 (书写 -> 擦除 -> 书写)
  duration: 1000,   // 单笔画书写/擦除耗时 (毫秒)，数值越小速度越快
  delay: 100,       // 笔画间的停顿 (毫秒)
  loopDelay: 2000,  // 写完后，停顿多久开始倒回 (仅在 loop=true 时有效)
  eraseDelay: 500,  // 倒回完后，停顿多久开始重写 (仅在 loop=true 时有效)
};

// --- 单笔画组件 ---
const AnimatedPath = ({
  d,
  color,
  index,
  currentStep,
  direction,
  recordedStrokeData,
  config
}) => {
  const strokeRef = useRef(null);
  const [len, setLen] = useState(0);
  const maskId = useId();
  const maskPath = recordedStrokeData?.d;
  const maskWidth = recordedStrokeData?.width || 12;

  useEffect(() => {
    if (strokeRef.current) setLen(strokeRef.current.getTotalLength());
  }, [maskPath]);

  // --- 状态计算逻辑 ---
  // direction: 1 (书写), -1 (擦除)
  let targetOpacity = 0;
  let targetOffset = len;

  if (index < currentStep) {
    targetOpacity = 1;
    targetOffset = 0;
  } else if (index > currentStep) {
    targetOpacity = 0;
    targetOffset = len;
  } else {
    // === 当前笔画 ===
    if (direction === 1) {
      targetOpacity = 1;
      targetOffset = 0;
    } else {
      targetOpacity = maskPath ? 1 : 0;
      targetOffset = len;
    }
  }

  const transitionStyle = {
    transition: `stroke-dashoffset ${config.duration}ms ease-in-out, opacity ${config.duration}ms ease-in-out`,
  };

  // 模式 A: 笔锋模式 (Mask 动画)
  if (maskPath) {
    return React.createElement(
      "g",
      null,
      React.createElement(
        "defs",
        null,
        React.createElement(
          "mask",
          { id: maskId, maskUnits: "userSpaceOnUse" },
          React.createElement("path", {
            ref: strokeRef,
            d: maskPath,
            stroke: "white",
            strokeWidth: maskWidth,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            fill: "none",
            strokeDasharray: len,
            strokeDashoffset: targetOffset,
            style: transitionStyle,
          })
        )
      ),
      React.createElement("path", {
        d: d,
        fill: color || "#000",
        mask: `url(#${maskId})`,
        style: {
          opacity: index > currentStep ? 0 : 1,
          transition: "opacity 0.2s",
        },
      })
    );
  }

  // 模式 B: 普通路径 (透明度动画)
  return React.createElement("path", {
    d: d,
    fill: color || "#000",
    style: { opacity: targetOpacity, ...transitionStyle },
  });
};

// --- 播放器主体 ---
const SignaturePlayer = ({ jsonUrl, options = {} }) => {
  const [data, setData] = useState(null);
  const [step, setStep] = useState(-1);
  const [direction, setDirection] = useState(1); // 1:书写, -1:倒回

  // 合并配置
  const config = useMemo(() => ({ ...DEFAULT_CONFIG, ...options }), [options]);

  // 加载数据
  useEffect(() => {
    if (!jsonUrl) return;
    fetch(jsonUrl)
      .then((r) => r.json())
      .then((json) => {
        if (json.paths) {
          setData(json);
          setTimeout(() => setStep(0), 500);
        }
      })
      .catch((e) => console.error("Trace Restore: Load failed:", e));
  }, [jsonUrl]);

  // 循环控制器
  useEffect(() => {
    if (!data) return;
    let timer;
    const total = data.paths.length;
    
    const nextTick = () => {
      if (direction === 1) {
        // --- 正向书写 ---
        if (step < total - 1) {
          setStep((s) => s + 1);
        } else {
          // 书写完毕
          if (config.loop) {
             // 只有开启循环，才进行倒回
            timer = setTimeout(() => setDirection(-1), config.loopDelay);
          }
          // 如果 loop=false，则停止在这里，不做任何操作
          return;
        }
      } else {
        // --- 反向擦除 (仅在 loop=true 时会进入此分支) ---
        if (step > 0) {
          setStep((s) => s - 1);
        } else {
          // 擦完 -> 等待 -> 切换为书写
          timer = setTimeout(() => setDirection(1), config.eraseDelay);
          return;
        }
      }
    };

    timer = setTimeout(nextTick, config.duration + config.delay);
    return () => clearTimeout(timer);
  }, [step, direction, data, config]);

  if (!data) return null;

  return React.createElement(
    "svg",
    {
      className: "signature-svg",
      viewBox: data.svgInfo.viewBox,
      preserveAspectRatio: "xMidYMid meet",
    },
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

// --- 导出挂载函数 ---
/**
 * 挂载签名动画
 * @param {string|HTMLElement} container 容器ID或DOM元素
 * @param {string} jsonUrl 动画数据文件路径
 * @param {Object} [options] 配置项
 * @param {boolean} [options.loop=true] 是否循环播放
 * @param {number} [options.duration=1000] 单笔画书写耗时(ms)
 * @param {number} [options.delay=100] 笔画间停顿(ms)
 * @param {number} [options.loopDelay=2000] 写完后的停留时间(ms)
 */
export function mountSignature(container, jsonUrl, options) {
  const dom =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!dom) return;
  const root = createRoot(dom);
  root.render(React.createElement(SignaturePlayer, { jsonUrl, options }));
  return root;
}