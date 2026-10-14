const STEPS = ['Choose supplies', 'Check your list', 'Send'];

// Where you are in a request: 1 choose, 2 check the list, 3 send. Not clickable.
export default function Progress({ step }) {
  return (
    <ol className="progress" aria-label="Steps to request supplies">
      {STEPS.map((label, i) => (
        <li key={label} className="progress__step" aria-current={i + 1 === step ? 'step' : undefined}>
          <span className="progress__n">{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}
