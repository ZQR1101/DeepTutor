import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChatExchangeRow } from '../src/features/chat/ChatExchangeRow';
import {
  emptyTurnDetails,
  projectTurnEvent,
} from '../src/features/chat/turnDetails';

test('an exact answer link reveals its source without fetching or navigating to the URL', () => {
  const url = '/api/knowledge-bases/math/source-page?id=notes.pdf#page=5';
  const details = projectTurnEvent(emptyTurnDetails, {
    type: 'sources',
    metadata: {
      sources: [
        {
          type: 'rag',
          title: 'notes.pdf',
          kb_name: 'general:kb:数学',
          content: '摘录：首尾配对。',
          page: '5',
          url,
        },
      ],
    },
  });
  const onBrowse = jest.fn();
  render(
    <ChatExchangeRow
      item={{
        id: 'row',
        question: '数列如何求和？',
        answer:
          '[查看这一页](' + url + ') · [另一个链接](https://example.invalid)',
        failed: null,
        retryable: false,
        details,
      }}
      active={false}
      sessionId="session"
      onBrowse={onBrowse}
    />,
  );
  expect(screen.queryByText('摘录：首尾配对。')).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.press(screen.getByText('查看这一页'));
  expect(screen.getByText('notes.pdf')).toBeTruthy();
  expect(screen.getByText('知识库 · 数学 · 第 5 页')).toBeTruthy();
  expect(screen.getByText('摘录：首尾配对。')).toBeTruthy();
  expect(onBrowse).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByText('摘录：首尾配对。')).toBeNull();
});
