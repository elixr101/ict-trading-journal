# 📈 ICT Trading Journal & Prop Firm Tracker

A Vibe Coded fast, private, and comprehensive trading journal built specifically for futures traders utilizing ICT (Inner Circle Trader) concepts and managing Prop Firm accounts. 

**Live Demo:** [Click here to view the live app](https://ict-trading-journal.vercel.app/)

## 🚀 Overview
This journal is designed to move beyond basic P&L tracking. It helps traders measure their psychological state, grade their setups based on strict pre-trade rules, track specific ICT entry models, and simulate future performance using real trading data.

**Privacy First:** This app is "offline-first." It does not use a cloud database. All of your trading data, accounts, and custom models are saved securely in your browser's local storage. Your data never leaves your device.

## ✨ Key Features

* 📊 **Advanced Dashboard:** Automatically calculates Win Rate, Profit Factor, Average Win/Loss, and visualizes your Equity Curve and Daily P&L calendar.
* 🏦 **Prop Firm Account Tracker:** Track multiple accounts across different firms (Topstep, Apex, Lucid, etc.). Monitor your current balance against Max Drawdown and Daily Loss limits, and track phase progressions (Evaluation to Funded).
* 🧠 **Psychology & Confluence Scoring:** Select multiple emotional states per trade. The app calculates a customized "Confluence Score" out of 10 based on your pre-trade rules, technical concepts used, and emotional state.
* 🎯 **ICT Concept Tagging:** Tag trades with specific ICT concepts (Silver Bullet, Judas Swing, FVG, BSL/SSL sweeps, Power of 3, etc.) to see which setups actually make you money.
* 🎲 **Monte Carlo Simulation:** Run thousands of simulations based on your actual logged trades to calculate your Probability of Profit, Probability of Ruin, and expected future drawdowns.

## 💻 Tech Stack
* **Framework:** React (Vite)
* **Styling:** Inline CSS / Custom minimal UI
* **Storage:** Browser `localStorage`

## 🛠️ How to Run Locally

If you want to download the code and run your own private version on your computer:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/elixr101/ict-trading-journal](https://github.com/elixr101/ict-trading-journal)



# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
