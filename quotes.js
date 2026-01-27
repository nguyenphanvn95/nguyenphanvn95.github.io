// lang_quotes_50.js
// 50 language-learning quotes + helpers (Anki-friendly)
//
// Usage (in your Back template):
// <script src="lang_quotes_50.js"></script>
// <script>
//   LANG_QUOTES_50.renderRandomQuote("langQuoteSlot", { probability: 0.35 });
// </script>
(function (w) {
  const QUOTES = [
    "Small steps every day beat big steps once in a while.",
    "Consistency is your unfair advantage.",
    "Progress over perfection.",
    "Mistakes are proof you’re learning.",
    "Fluency is built, not wished for.",
    "Learn a little, use a lot.",
    "Repeat, but with attention.",
    "If you can hear it, you can say it.",
    "Read. Listen. Imitate. Speak.",
    "One word today is one more than yesterday.",

    "Make it easy, then make it daily.",
    "Don’t wait for confidence—practice creates it.",
    "Pronunciation improves with brave speaking.",
    "Your accent is a sign of courage.",
    "Understanding comes before speed.",
    "Slow is smooth. Smooth is fast.",
    "Focus on meaning, then polish form.",
    "The best study plan is the one you follow.",
    "Short sessions, long streaks.",
    "Show up, even for 5 minutes.",

    "Learn in context, not in isolation.",
    "Sentences teach you how words behave.",
    "Vocabulary sticks when you use it.",
    "Say it out loud—memory loves sound.",
    "Write it once, recall it twice.",
    "Your brain remembers what you retrieve.",
    "Review is where growth happens.",
    "Today’s review is tomorrow’s fluency.",
    "Aim for clear, not fancy.",
    "Simple English is powerful English.",

    "Input gives you ideas; output gives you skill.",
    "Listening trains your mouth.",
    "Shadowing turns noise into speech.",
    "You don’t need talent—you need reps.",
    "Practice beats motivation.",
    "Make errors early, fix them fast.",
    "Speak before you feel ready.",
    "Every attempt is a deposit in your fluency bank.",
    "The goal is communication, not perfection.",
    "Clarity > complexity.",

    "Learn the phrases you actually need.",
    "Study what you want to say next week.",
    "Use it today or lose it tomorrow.",
    "The best dictionary is a good example sentence.",
    "A new word is useless until it’s yours.",
    "Fewer words, deeper mastery.",
    "Build habits, not pressure.",
    "You’re closer than you think.",
    "Keep going—your future self is listening.",
    "Stay consistent, stay kind to yourself."
  ];

  // ✅ Default text when a quote is NOT shown
  const DEFAULT_FALLBACK = "✨ Keep practicing — you’re building fluency.";

  function randInt(n) {
    return Math.floor(Math.random() * n);
  }

  function pickQuote() {
    return QUOTES[randInt(QUOTES.length)];
  }

  /**
   * Render a quote into an element (by id or element)
   * @param {string|HTMLElement} target
   * @param {{prefix?:string, probability?:number, fallback?:string}} opts
   */
  function renderRandomQuote(target, opts) {
    opts = opts || {};
    const prefix = (opts.prefix ?? "🌱 ");
    const p = (opts.probability ?? 0.35); // show quote on ~35% of cards
    const fallback = (opts.fallback ?? DEFAULT_FALLBACK);

    const el = (typeof target === "string") ? document.getElementById(target) : target;
    if (!el) return;

    if (Math.random() <= p) {
      el.textContent = prefix + pickQuote();
      el.classList.add("has-quote");
    } else {
      el.textContent = fallback;
      el.classList.remove("has-quote");
    }
  }

  // export
  w.LANG_QUOTES_50 = {
    QUOTES,
    DEFAULT_FALLBACK,
    pickQuote,
    renderRandomQuote
  };
})(window);
