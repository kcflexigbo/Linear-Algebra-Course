interface Snippet {
  label: string;
  value: string;
}

interface SnippetGroup {
  group: string;
  snips: Snippet[];
}

const GROUPS: SnippetGroup[] = [
  {
    group: 'solve',
    snips: [
      { label: '.rref()', value: '.rref()' },
      { label: '.solve_right(b)', value: '.solve_right(b)' },
      { label: '.kernel()', value: '.kernel()' },
      { label: '.right_kernel()', value: '.right_kernel()' },
    ],
  },
  {
    group: 'properties',
    snips: [
      { label: '.det()', value: '.det()' },
      { label: '.rank()', value: '.rank()' },
      { label: '.trace()', value: '.trace()' },
      { label: '.inverse()', value: '.inverse()' },
      { label: '.transpose()', value: '.transpose()' },
    ],
  },
  {
    group: 'spectral',
    snips: [
      { label: '.eigenvalues()', value: '.eigenvalues()' },
      { label: '.eigenvectors_right()', value: '.eigenvectors_right()' },
      { label: '.charpoly()', value: '.charpoly()' },
    ],
  },
  {
    group: 'spaces',
    snips: [
      { label: '.column_space()', value: '.column_space()' },
      { label: '.row_space()', value: '.row_space()' },
      { label: '.image()', value: '.image()' },
    ],
  },
  {
    group: 'ops',
    snips: [
      { label: '·', value: ' * ' },
      { label: '+', value: ' + ' },
      { label: '−', value: ' - ' },
      { label: '^', value: '^' },
    ],
  },
  {
    group: 'print',
    snips: [
      { label: 'show(', value: 'show(' },
      { label: 'print(', value: 'print(' },
      { label: 'latex(', value: 'latex(' },
    ],
  },
];

interface Props {
  onInsert: (snip: string) => void;
}

export function SnippetBar({ onInsert }: Props) {
  return (
    <div className="snippets">
      {GROUPS.map(({ group, snips }) => (
        <span key={group} style={{ display: 'contents' }}>
          <span className="snip-group-label">{group}</span>
          {snips.map((s) => (
            <button key={s.value} className="snip" onClick={() => onInsert(s.value)}>
              {s.label}
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
