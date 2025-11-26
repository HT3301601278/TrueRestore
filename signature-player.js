import React, { useState, useEffect, useRef, useId } from "react";
import { createRoot } from "react-dom/client";

// --- 样式注入 ---
const styleId = "signature-player-styles";
if (!document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = `.signature-svg { width: 100%; height: 100%; overflow: visible; display: block; }`;
  document.head.appendChild(style);
}

// --- 核心配置 ---
const CONFIG = {
  duration: 1000, // 单笔画书写/擦除耗时
  delay: 100, // 笔画间的停顿
  loopDelay: 2000, // 写完后，停顿多久开始倒回
  eraseDelay: 500, // 倒回完后，停顿多久开始重写
};

// --- 单笔画组件 ---
const AnimatedPath = ({
  d,
  color,
  index,
  currentStep,
  direction,
  recordedStrokeData,
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
    // 书写(1) -> 偏移量归0 (显示)
    // 擦除(-1) -> 偏移量归最大 (隐藏)
    if (direction === 1) {
      targetOpacity = 1;
      targetOffset = 0;
    } else {
      targetOpacity = maskPath ? 1 : 0;
      targetOffset = len;
    }
  }

  const transitionStyle = {
    transition: `stroke-dashoffset ${CONFIG.duration}ms ease-in-out, opacity ${CONFIG.duration}ms ease-in-out`,
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
const SignaturePlayer = ({ jsonUrl }) => {
  const [data, setData] = useState(null);
  const [step, setStep] = useState(-1);
  const [direction, setDirection] = useState(1); // 1:书写, -1:倒回

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
      .catch((e) => console.error("Load failed:", e));
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
          // 写完 -> 等待 -> 切换为倒回
          timer = setTimeout(() => setDirection(-1), CONFIG.loopDelay);
          return;
        }
      } else {
        // --- 反向擦除 ---
        if (step > 0) {
          setStep((s) => s - 1);
        } else {
          // 擦完 -> 等待 -> 切换为书写
          timer = setTimeout(() => setDirection(1), CONFIG.eraseDelay);
          return;
        }
      }
    };

    timer = setTimeout(nextTick, CONFIG.duration + CONFIG.delay);
    return () => clearTimeout(timer);
  }, [step, direction, data]);

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
      })
    )
  );
};

// --- 导出挂载函数 ---
export function mountSignature(container, jsonUrl) {
  const dom =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!dom) return;
  const root = createRoot(dom);
  root.render(React.createElement(SignaturePlayer, { jsonUrl }));
  return root;
}
