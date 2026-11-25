// The page works without this file; it adds the chart tooltips, the copy buttons and the system tabs.
(() => {
  // A value under the pointer or the keyboard focus: the value leads, the label follows. Text only, never HTML.
  const tip = document.querySelector(".tooltip")
  const [value, label] = tip ? [tip.querySelector("b"), tip.querySelector("span")] : []
  const show = (mark, x, y) => {
    value.textContent = mark.dataset.tipValue || ""
    label.textContent = mark.dataset.tipLabel || ""
    tip.hidden = false
    const box = tip.getBoundingClientRect()
    tip.style.left = `${Math.min(x + 14, window.innerWidth - box.width - 8)}px`
    tip.style.top = `${Math.max(8, y - box.height - 10)}px`
  }
  const hide = () => {
    if (tip) tip.hidden = true
  }
  // A scroll moves the page under a still pointer: the mark it showed is no longer there.
  window.addEventListener("scroll", hide, { passive: true })
  for (const mark of document.querySelectorAll(".chart .mark")) {
    mark.addEventListener("pointermove", (event) => show(mark, event.clientX, event.clientY))
    mark.addEventListener("pointerleave", hide)
    mark.addEventListener("focus", () => {
      const box = mark.getBoundingClientRect()
      show(mark, box.left + box.width / 2, box.top)
    })
    mark.addEventListener("blur", hide)
  }

  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
        const before = button.textContent
        button.textContent = "Скопировано"
        setTimeout(() => (button.textContent = before), 1500)
      } catch {
        // No clipboard here (an old browser or http): the command stays on screen to select by hand.
      }
    })
  }

  // The tabs pick the visitor's system first; arrows move between them.
  for (const box of document.querySelectorAll("[data-tabs]")) {
    const tabs = [...box.querySelectorAll('[role="tab"]')]
    const select = (tab) => {
      for (const other of tabs) {
        const on = other === tab
        other.setAttribute("aria-selected", String(on))
        other.tabIndex = on ? 0 : -1
        document.getElementById(other.getAttribute("aria-controls")).hidden = !on
      }
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab))
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
        select(next)
        next.focus()
      })
    })
    const system = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""
    if (!/win/i.test(system) && tabs[1]) select(tabs[1])
  }
})()
