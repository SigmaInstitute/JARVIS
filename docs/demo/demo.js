// Jarvis Worker Spending Kit Demo (static)
// This demo does NOT execute real payments. It only evaluates a spend request against a sample policy.

(function () {
  const policy = {
    perTxCap: 300,
    monthlyCapDefault: 5000,
    allowlistVendors: ["AWS", "OpenAI", "GitHub", "Amazon", "Upwork", "Coursera", "GiveWell", "MSF"],
    allowlistCategories: ["ops_compute", "tooling", "reliability", "knowledge_assets", "human_services", "charity"],
    humanInLoop: {
      amountGte: 200,
      categories: ["charity", "human_services"],
    },
    requiredFields: ["amount", "vendor", "category", "reason_code", "linked_deliverable_id", "expected_effect"],
  };

  const examples = {
    tooling: {
      amount: 49,
      currency: "USD",
      vendor: "GitHub",
      category: "tooling",
      reason_code: "tooling_subscription",
      linked_deliverable_id: "2026-03-demo-clientA",
      expected_effect: "enable experiment tracking / version control for reproducibility",
      risk_level: "R1",
    },
    reliability: {
      amount: 180,
      currency: "USD",
      vendor: "Upwork",
      category: "human_services",
      reason_code: "independent_review",
      linked_deliverable_id: "2026-03-demo-clientB",
      expected_effect: "pay for human review & statistical checks as conclusion insurance",
      risk_level: "R2",
    },
    charity: {
      amount: 50,
      currency: "USD",
      vendor: "GiveWell",
      category: "charity",
      reason_code: "charity_take_rate",
      linked_deliverable_id: "2026-03-profit-pool",
      expected_effect: "auditable donation with purpose tags and receipt requirement",
      purpose_tag: "education",
      risk_level: "R0",
    },
    suspicious: {
      amount: 10,
      currency: "USD",
      vendor: "UnknownVendor",
      category: "tooling",
      reason_code: "misc",
      linked_deliverable_id: "n/a",
      expected_effect: "",
      risk_level: "R3",
      repeat_count_1h: 12
    }
  };

  function $(id) { return document.getElementById(id); }

  function decisionRank(d) {
    const order = ["APPROVE", "REQUIRE_HUMAN_APPROVAL", "REJECT", "FREEZE"];
    return order.indexOf(d);
  }

  function upgradeDecision(current, next) {
    return decisionRank(next) > decisionRank(current) ? next : current;
  }

  function nowIso() {
    const d = new Date();
    return d.toISOString();
  }

  function evaluate(req, spentSoFar, monthlyCap) {
    let decision = "APPROVE";
    const reasons = [];
    const next = [];

    // Required fields
    const missing = [];
    policy.requiredFields.forEach((k) => {
      if (req[k] === undefined || req[k] === null || (typeof req[k] === "string" && req[k].trim() === "")) missing.push(k);
    });
    if (missing.length) {
      decision = upgradeDecision(decision, "REJECT");
      reasons.push("缺少必要字段: " + missing.join(", "));
      next.push("补齐字段后再评估（尤其是 reason_code / linked_deliverable_id / expected_effect）。");
    }

    // Category allowlist
    if (req.category && !policy.allowlistCategories.includes(req.category)) {
      decision = upgradeDecision(decision, "REJECT");
      reasons.push("类目不在白名单: " + req.category);
      next.push("将 category 调整为允许的类目，或把该类目加入白名单（需要治理流程）。");
    }

    // Vendor allowlist
    if (req.vendor && !policy.allowlistVendors.includes(req.vendor)) {
      decision = upgradeDecision(decision, "REQUIRE_HUMAN_APPROVAL");
      reasons.push("商家不在白名单: " + req.vendor + "（需要人工审批）");
      next.push("人工核验供应商身份与收款路径；必要时改用白名单供应商。");
    }

    // Budget rules
    const cap = (typeof monthlyCap === "number" && monthlyCap >= 0) ? monthlyCap : policy.monthlyCapDefault;
    const remaining = Math.max(0, cap - Math.max(0, spentSoFar || 0));

    if (typeof req.amount === "number") {
      if (req.amount > remaining) {
        decision = upgradeDecision(decision, "REJECT");
        reasons.push("超出当月剩余预算: remaining=" + remaining + " USD");
        next.push("降低金额、等待下个预算周期，或提高预算上限（需要审批/复盘）。");
      }
      if (req.amount > policy.perTxCap) {
        decision = upgradeDecision(decision, "REQUIRE_HUMAN_APPROVAL");
        reasons.push("超过单笔限额: perTxCap=" + policy.perTxCap + " USD（需要人工审批）");
        next.push("人工确认该支出必要性；必要时拆分为里程碑付款。");
      }
    }

    // Human-in-the-loop for certain categories
    if (req.category && policy.humanInLoop.categories.includes(req.category) && typeof req.amount === "number" && req.amount >= policy.humanInLoop.amountGte) {
      decision = upgradeDecision(decision, "REQUIRE_HUMAN_APPROVAL");
      reasons.push("高风险类目/金额触发人工审批阈值（" + req.category + ", amount≥" + policy.humanInLoop.amountGte + "）");
      next.push("人工确认用途标签/回执要求/验收标准。");
    }

    // Anomaly / kill-switch demo rule
    if (typeof req.repeat_count_1h === "number" && req.repeat_count_1h >= 10 && typeof req.amount === "number" && req.amount <= 20) {
      decision = upgradeDecision(decision, "FREEZE");
      reasons.push("触发异常规则：短时高频小额（repeat_count_1h≥10 & amount≤20）");
      next.push("冻结支出通道；人工排查是否为欺诈/刷单/脚本误触发；复盘后再解冻。");
    }

    if (!reasons.length) {
      reasons.push("未触发风险规则（示例策略下可自动通过）。");
      next.push("记录回执/发票信息，并在月度复盘中评估该支出的实际效果。");
    }

    const badge = (decision === "APPROVE") ? "✅ APPROVE"
      : (decision === "REQUIRE_HUMAN_APPROVAL") ? "🧑‍⚖️ REQUIRE_HUMAN_APPROVAL"
      : (decision === "REJECT") ? "⛔ REJECT"
      : "🧊 FREEZE";

    const ledger = {
      id: "ledger_" + Math.random().toString(16).slice(2),
      ts: nowIso(),
      decision: decision,
      decision_badge: badge,
      reasons: reasons,
      request: {
        amount: req.amount,
        currency: req.currency || "USD",
        vendor: req.vendor,
        category: req.category,
        reason_code: req.reason_code,
        linked_deliverable_id: req.linked_deliverable_id,
        expected_effect: req.expected_effect,
        risk_level: req.risk_level || "R?",
        purpose_tag: req.purpose_tag || null
      }
    };

    return { decision, badge, reasons, next, ledger };
  }

  function setExample(name) {
    $("req").value = JSON.stringify(examples[name], null, 2);
    run();
  }

  function renderList(el, items) {
    el.innerHTML = "";
    items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      el.appendChild(li);
    });
  }

  function run() {
    let req;
    try {
      req = JSON.parse($("req").value);
    } catch (e) {
      $("decision").textContent = "⛔ REJECT";
      renderList($("reasons"), ["JSON 解析失败：请检查格式。"]);
      renderList($("next"), ["使用上方“示例”按钮填充一个有效请求，或修正 JSON 格式。"]);
      $("ledger").textContent = "{}";
      return;
    }
    const spent = Number($("spent").value || 0);
    const cap = Number($("cap").value || policy.monthlyCapDefault);

    const out = evaluate(req, spent, cap);
    $("decision").textContent = out.badge;
    renderList($("reasons"), out.reasons);
    renderList($("next"), out.next);
    $("ledger").textContent = JSON.stringify(out.ledger, null, 2);
  }

  function bind() {
    // Initial content
    $("req").value = JSON.stringify(examples.tooling, null, 2);

    // Buttons
    document.querySelectorAll("[data-example]").forEach((btn) => {
      btn.addEventListener("click", () => setExample(btn.dataset.example));
    });

    $("btnEval").addEventListener("click", run);

    // Re-evaluate on param changes
    $("spent").addEventListener("input", run);
    $("cap").addEventListener("input", run);
  }

  window.addEventListener("DOMContentLoaded", () => {
    bind();
    run();
  });
})();
