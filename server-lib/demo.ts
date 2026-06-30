// Built-in demo course based on the "Understanding Youth Gaming" podcast script.
// Used by the "Load demo" button.

export type DemoModule = {
  id: string;
  title: string;
  contentHtml: string;
  sourceChunkIndex?: number;
};

export type DemoQuiz = {
  moduleId: string;
  passingScore: number;
  questions: {
    id: string;
    prompt: string;
    choices: string[];
    correctIndex: number;
    explanation: string;
  }[];
};

export type DemoCourse = {
  courseTitle: string;
  courseDescription: string;
  modules: DemoModule[];
  quizzes: DemoQuiz[];
  passMark: number;
};

const course: DemoCourse = {
  courseTitle: "Understanding Youth Gaming",
  courseDescription: "An evidence-based exploration of why youths game, the mechanisms that make it compelling, identifying warning signs, and supporting healthy change.",
  passMark: 80,
  modules: [
    {
      id: "why-youths-game",
      title: "1 · Why youths game",
      contentHtml: `
        <h2>Understanding the Motivations Behind Youth Gaming</h2>
        <p><strong>Overview.</strong> While often misunderstood, gaming is a complex activity that fulfills essential developmental needs. For youths, it is rarely just about "distraction."</p>
        <blockquote><p><strong>Key Insight:</strong> Gaming usually starts as a social connection or entertainment; it only becomes risky when patterns and context shift.</p></blockquote>
        <h3>Why Youths Game</h3>
        <ul>
          <li><strong>Social Connection:</strong> Fosters peer bonding and combats feelings of isolation.</li>
          <li><strong>Stress Relief:</strong> Reduces cortisol levels and stimulates the brain's reward system.</li>
          <li><strong>Challenge & Achievement:</strong> Provides structured goal-setting and immediate feedback.</li>
          <li><strong>Escapism:</strong> Offers a temporary refuge from academic or personal stressors.</li>
        </ul>
      `,
    },
    {
      id: "gaming-mechanisms",
      title: "2 · The science of engagement",
      contentHtml: `
        <h2>Why Gaming is So Compelling</h2>
        <p><strong>Overview.</strong> Modern games are engineered to be engaging. Understanding the science behind this is the first step toward building healthy boundaries.</p>
        <h3>The Brain’s Reward System</h3>
        <p>Gaming releases dopamine, activating the brain’s motivation and reinforcement pathways — similar to winning a prize. This biological response is what drives habit formation.</p>
        <h3>Compulsion Loops</h3>
        <p>Game design relies on "compulsion loops" to keep players returning:</p>
        <ul>
          <li><strong>Anticipation:</strong> Timers, countdowns, and "daily login" rewards create a sense of urgency.</li>
          <li><strong>Variable Reinforcement:</strong> Unpredictable rewards (like loot boxes) trigger heightened excitement.</li>
          <li><strong>Visual & Audio Cues:</strong> High-energy feedback that reinforces success.</li>
        </ul>
        <h3>Loot Boxes & Gambling</h3>
        <p>Loot boxes operate on mechanisms structurally similar to gambling. They introduce uncertainty, suspense, and emotional highs, which can be particularly challenging for youths developing impulse control.</p>
      `,
    },
    {
      id: "signs-of-concern",
      title: "3 · When gaming becomes a concern",
      contentHtml: `
        <h2>Identifying Problematic Patterns</h2>
        <p><strong>Overview.</strong> It’s not just about hours spent; it’s about the impact on daily life and wellbeing. Recognize the red flags.</p>
        <h3>Warning Signs</h3>
        <ul>
          <li><strong>Preoccupation:</strong> Constant thoughts about gaming or increased hours.</li>
          <li><strong>Withdrawal:</strong> Significant irritability or mood swings when unable to game.</li>
          <li><strong>Control Issues:</strong> Inability to cut down despite negative consequences.</li>
          <li><strong>Neglect:</strong> Dropping hobbies, responsibilities, or social activities.</li>
        </ul>
        <h3>Gamification in Everyday Life</h3>
        <p>Be aware that these compulsive loops now exist outside of games. Shopping apps, fitness trackers, and social media platforms use "streaks," badges, and instant gratification to keep you engaged.</p>
      `,
    },
  ],
  quizzes: [
    {
      moduleId: "why-youths-game",
      passingScore: 80,
      questions: [
        {
          id: "q-why-1",
          prompt: "Which of the following is a key psychological benefit youths often derive from healthy gaming?",
          choices: ["Social connection and peer bonding", "Complete avoidance of academic tasks", "Total elimination of daily stress", "Financial gain through gaming"],
          correctIndex: 0,
          explanation: "Gaming fosters peer bonding and reduces feelings of loneliness when managed in a healthy way.",
        },
      ],
    },
    {
      moduleId: "gaming-mechanisms",
      passingScore: 80,
      questions: [
        {
          id: "q-mech-1",
          prompt: "Why are loot boxes considered potentially risky?",
          choices: ["They share structural similarities with gambling", "They guarantee an item of high value", "They require no emotional investment", "They are strictly regulated globally"],
          correctIndex: 0,
          explanation: "Loot boxes use mechanisms of uncertainty and suspense that share similarities with gambling, potentially creating compulsive behaviors.",
        },
      ],
    },
    {
      moduleId: "signs-of-concern",
      passingScore: 80,
      questions: [
        {
          id: "q-signs-1",
          prompt: "What is a major indicator that gaming patterns may be concerning?",
          choices: ["Increased irritability when unable to play", "Playing games on weekends only", "Talking about favorite games with friends", "Spending time gaming with family"],
          correctIndex: 0,
          explanation: "Withdrawal symptoms like irritability or mood swings when unable to game are key signs that gaming is impacting wellbeing.",
        },
      ],
    },
  ],
};

export default course;

export function getDemoChunks() {
  return course.modules.map((m, i) => ({
    index: i,
    title: m.title,
    content: m.contentHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    source: "Built-in demo",
    suggestedQuestions: course.quizzes.find((q) => q.moduleId === m.id)?.questions ?? [],
  }));
}

export function getDemoSourceFile() {
  return {
    name: `${course.courseTitle}.demo`,
    mime: "application/x-scorm-demo",
    size: course.modules.reduce((n, m) => n + m.contentHtml.length, 0),
  };
}
