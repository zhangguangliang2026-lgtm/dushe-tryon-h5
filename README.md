# 独奢 · 手链 AR 试戴测试页

网页版试戴可行性测试：在手机浏览器（含微信内置浏览器）里打开摄像头，用 MediaPipe 识别手部 21 个关键点，把手链画到手腕上，并按手的 3D 方向跟着手腕转动。

- 识别在手机本地运行，画面不上传。
- 首次打开需要下载约 10MB 的模型文件。
- `app.js` 由 `src/main.js` 打包生成（esbuild）；手链排布和绘制沿用小程序原型的 tryon-core / tryon-render。

## 第三方组件

- `tasks/`：@mediapipe/tasks-vision 1.2.2（Google），Apache License 2.0，见 `tasks/LICENSE`。0.7 起试戴页用它，默认 CPU 计算。
- `models/hand_landmarker.task`：MediaPipe 官方手部模型（float16），Apache License 2.0。文件取自 npm 包 @beautinique/frontend-tryon-assets，已核对其中两个网络的权重与 Google 官方 @mediapipe/hands 包一致。

- `mediapipe/`：旧版 MediaPipe Hands 0.4.1675469240（只给 diag2.html 用）（Google），Apache License 2.0，许可证全文见 `mediapipe/LICENSE`。文件未做修改。
- `beads/`：珠子图片，独奢所有。
