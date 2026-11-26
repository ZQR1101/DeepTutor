import { Alert } from 'react-native';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { KnowledgeDetailScreen } from '../src/screens/knowledge/KnowledgeDetailScreen';
import { KnowledgeListScreen } from '../src/screens/knowledge/KnowledgeListScreen';
import { KnowledgePicker } from '../src/screens/knowledge/KnowledgePicker';
import type { UploadItem } from '../src/features/knowledge/useUploads';
import type {
  KnowledgeBaseSummary,
  KnowledgeFileEntry,
  KnowledgeProgress,
} from '../src/services/knowledgeApi';

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function button(label: string) {
  const match = screen.getAllByRole('button').find(node => node.props.accessibilityLabel === label);
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

function base(overrides: Partial<KnowledgeBaseSummary> = {}): KnowledgeBaseSummary {
  return {
    ref: 'user:kb:physics',
    id: 'user:kb:physics',
    name: 'physics',
    description: 'Mechanics',
    status: 'ready',
    isDefault: false,
    documentCount: 2,
    imageCount: 0,
    chunkCount: 0,
    ragInitialized: true,
    needsReindex: false,
    provider: 'llamaindex',
    assigned: false,
    readOnly: false,
    available: true,
    progress: null,
    lastError: '',
    updatedAt: '',
    ...overrides,
  };
}

function file(name: string, overrides: Partial<KnowledgeFileEntry> = {}): KnowledgeFileEntry {
  return {
    name,
    type: 'file',
    size: 1024,
    modified: 1_700_000_000,
    mimeType: 'application/pdf',
    ...overrides,
  };
}

function progress(overrides: Partial<KnowledgeProgress> = {}): KnowledgeProgress {
  return {
    stage: 'processing_file',
    message: '解析中',
    current: 1,
    total: 2,
    percent: 50,
    fileName: 'a.pdf',
    error: '',
    retryable: true,
    updatedAt: '',
    ...overrides,
  };
}

function list(overrides: Partial<React.ComponentProps<typeof KnowledgeListScreen>> = {}) {
  return render(
    <KnowledgeListScreen
      bases={[]}
      status="ready"
      refreshing={false}
      error={null}
      creating={false}
      onCreate={jest.fn(async () => null)}
      onOpen={jest.fn()}
      onRefresh={jest.fn()}
      onRetry={jest.fn()}
      onBack={jest.fn()}
      {...overrides}
    />,
  );
}

test('the list says it is loading rather than showing an empty catalogue', () => {
  list({ status: 'loading' });
  expect(screen.getByText('正在加载知识库…')).toBeTruthy();
});

test('an empty catalogue invites the first base instead of looking broken', () => {
  list();
  expect(screen.getByText('暂无知识库')).toBeTruthy();
});

test('a failed first load offers a retry and keeps the reason', () => {
  const onRetry = jest.fn();
  list({
    status: 'failed',
    error: '无法连接服务器，请检查网络。',
    onRetry,
  });
  expect(
    screen.getByText('无法连接服务器，请检查网络。'),
  ).toBeTruthy();
  fireEvent.press(button('重试'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('a knowledge base row shows its name alone', () => {
  list({
    bases: [
      base(),
      base({
        ref: 'admin:kb:shared',
        id: 'admin:kb:shared',
        name: 'shared',
        assigned: true,
        readOnly: true,
        documentCount: 1,
      }),
    ],
  });
  expect(button('shared')).toBeTruthy();
  expect(screen.queryByText('Mechanics')).toBeNull();
  expect(screen.queryByText(/份文档|与你共享|只读|就绪/)).toBeNull();
});

test('opening a row passes the handle the server routes on', () => {
  const onOpen = jest.fn();
  list({ bases: [base({ ref: 'admin:kb:shared', name: 'shared', assigned: true })], onOpen });
  fireEvent.press(button('shared'));
  expect(onOpen).toHaveBeenCalledWith('admin:kb:shared');
});

test('creating a base needs a name and keeps the sheet open when refused', async () => {
  const onCreate = jest.fn(async () => 'This knowledge base already exists.');
  list({ onCreate });

  fireEvent.press(button('新建'));
  expect(button('创建').props.accessibilityState.disabled).toBe(true);

  fireEvent.changeText(screen.getByLabelText('名称'), '  biology  ');
  await act(async () => {
    fireEvent.press(button('创建'));
  });
  expect(onCreate).toHaveBeenCalledWith('biology');
  // The name is kept so it can be corrected rather than retyped.
  expect(screen.getByText('This knowledge base already exists.')).toBeTruthy();
  expect(screen.getByLabelText('名称')).toBeTruthy();
});

test('a created base closes the sheet', async () => {
  const onCreate = jest.fn(async () => null);
  list({ onCreate });

  fireEvent.press(button('新建'));
  fireEvent.changeText(screen.getByLabelText('名称'), 'biology');
  await act(async () => {
    fireEvent.press(button('创建'));
  });
  expect(onCreate).toHaveBeenCalledWith('biology');
  expect(screen.queryByLabelText('名称')).toBeNull();
});

function detail(
  overrides: Partial<React.ComponentProps<typeof KnowledgeDetailScreen>> = {},
) {
  const uploads = {
    items: [] as UploadItem[],
    cancel: jest.fn(),
    retry: jest.fn(),
    dismiss: jest.fn(),
  };
  const props: React.ComponentProps<typeof KnowledgeDetailScreen> = {
    kb: base(),
    files: [file('a.pdf')],
    status: 'ready',
    error: null,
    refreshing: false,
    retrying: false,
    saving: false,
    policy: {
      extensions: ['.pdf'],
      accept: '.pdf',
      maxFileSizeBytes: 1024 * 1024,
      allowAnyExtension: false,
    },
    uploads,
    onBack: jest.fn(),
    onRefresh: jest.fn(),
    onRetry: jest.fn(),
    onPickFiles: jest.fn(),
    onDeleteFile: jest.fn(async () => true),
    onSaveDescription: jest.fn(async () => true),
    onDeleteBase: jest.fn(),
    ...overrides,
  };
  render(<KnowledgeDetailScreen {...props} />);
  // The caller's overrides are what the screen actually received.
  return { props, uploads: props.uploads };
}

test('the detail header names the base and what it holds', () => {
  detail();
  expect(screen.getByText('physics')).toBeTruthy();
  expect(screen.getByText('2 份文档 · llamaindex')).toBeTruthy();
  expect(screen.getByText('a.pdf')).toBeTruthy();
});

test('removing a document asks first and warns that vectors remain', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onDeleteFile = jest.fn(async () => true);
  detail({ onDeleteFile });

  fireEvent.press(screen.getByLabelText('移除 a.pdf'));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, actions] = alert.mock.calls[0];
  expect(title).toBe('移除此文档？');
  expect(message).toContain('向量记录');
  expect(onDeleteFile).not.toHaveBeenCalled();

  const confirm = actions?.find(action => action.text === '移除');
  confirm?.onPress?.();
  await waitFor(() => expect(onDeleteFile).toHaveBeenCalledWith('a.pdf'));
});

test('deleting the base asks first and then leaves it to the caller', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onDeleteBase = jest.fn();
  detail({ onDeleteBase });
  fireEvent.press(button('删除'));
  expect(alert.mock.calls[0][0]).toBe('删除此知识库？');
  alert.mock.calls[0][2]?.find(action => action.text === '删除')?.onPress?.();
  expect(onDeleteBase).toHaveBeenCalledTimes(1);
});

test('a read-only base hides every write action and says why', () => {
  detail({
    kb: base({ readOnly: true, assigned: true }),
    policy: null,
  });
  expect(screen.queryByText('上传文件')).toBeNull();
  expect(screen.queryByText('删除')).toBeNull();
  expect(screen.queryByText('编辑描述')).toBeNull();
  expect(screen.getByText('你对此知识库只有读取权限。')).toBeTruthy();
});

test('a failed run shows the parser’s reason and offers a retry', () => {
  const onRetry = jest.fn();
  detail({
    kb: base({
      status: 'error',
      progress: progress({ stage: 'error', error: 'No text layer in this PDF' }),
    }),
    files: [file('scan.pdf')],
    onRetry,
  });
  expect(screen.getByText('No text layer in this PDF')).toBeTruthy();
  fireEvent.press(button('重新处理'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('a live run shows the server’s own percentage and file', () => {
  detail({
    kb: base({ status: 'processing', progress: progress() }),
  });
  const bar = screen.getByRole('progressbar');
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  expect(screen.getByText('1 / 2 · a.pdf')).toBeTruthy();
});

test('an index older than its documents says so instead of claiming work', () => {
  detail({ kb: base({ status: 'needs_reindex' }) });
  expect(
    screen.getByText(
      '文档已更新，请在网页版重建索引后再引用。',
    ),
  ).toBeTruthy();
});

test('a document row says the run finished instead of claiming the file is ready', () => {
  detail({
    kb: base({ status: 'ready', progress: progress({ stage: 'completed' }) }),
  });
  // The base itself is ready…
  expect(screen.getByText('就绪')).toBeTruthy();
  // …but the server reports per run, so the file row says exactly that.
  expect(screen.getByText('本轮处理完成')).toBeTruthy();
  expect(screen.getByText(/最近一批已处理完毕/)).toBeTruthy();
});

test('only the file the parser names is shown as parsing', () => {
  detail({
    kb: base({ status: 'processing', progress: progress({ message: '' }) }),
    files: [file('a.pdf'), file('b.pdf')],
  });
  expect(screen.getByText('解析中')).toBeTruthy();
  // The other file is part of the run but is not being read right now.
  expect(screen.getByText('处理中')).toBeTruthy();
});

test('upload rows describe their own progress, cancel and retry', async () => {
  const items: UploadItem[] = [
    {
      id: 'u1',
      name: 'big.pdf',
      size: 200,
      status: 'uploading',
      loaded: 50,
      total: 200,
      error: null,
      retryable: true,
      uri: 'file:///big.pdf',
      mimeType: 'application/pdf',
    },
    {
      id: 'u2',
      name: 'bad.pdf',
      size: 10,
      status: 'failed',
      loaded: 0,
      total: 10,
      error: '文件过大，服务器拒绝接收。',
      retryable: true,
      uri: 'file:///bad.pdf',
      mimeType: 'application/pdf',
    },
    {
      id: 'u3',
      name: 'done.pdf',
      size: 10,
      status: 'done',
      loaded: 10,
      total: 10,
      error: null,
      retryable: true,
      uri: 'file:///done.pdf',
      mimeType: 'application/pdf',
    },
  ];
  const { uploads } = detail({ uploads: { items, cancel: jest.fn(), retry: jest.fn(), dismiss: jest.fn() } });

  expect(screen.getByText('25% · 50 B / 200 B')).toBeTruthy();
  expect(screen.getByText('文件过大，服务器拒绝接收。')).toBeTruthy();
  expect(screen.getByText('上传完成，服务器正在处理。')).toBeTruthy();

  fireEvent.press(button('取消上传 big.pdf'));
  expect(uploads.cancel).toHaveBeenCalledWith('u1');
  fireEvent.press(button('重试上传 bad.pdf'));
  expect(uploads.retry).toHaveBeenCalledWith('u2');
  fireEvent.press(button('关闭 done.pdf 的上传状态'));
  expect(uploads.dismiss).toHaveBeenCalledWith('u3');
});

test('the description is edited in a sheet and saved to the server', async () => {
  const onSaveDescription = jest.fn(async () => true);
  detail({ onSaveDescription });
  fireEvent.press(button('编辑描述'));
  fireEvent.changeText(screen.getByLabelText('描述'), '  Waves  ');
  fireEvent.press(button('保存'));
  await waitFor(() => expect(onSaveDescription).toHaveBeenCalledWith('Waves'));
  expect(screen.queryByLabelText('描述')).toBeNull();
});

test('the picker refuses a base whose index is not ready and explains it', () => {
  const onToggle = jest.fn();
  render(
    <KnowledgePicker
      visible
      bases={[
        base(),
        base({ ref: 'user:kb:bio', name: 'bio', status: 'processing' }),
        base({ ref: 'account:kb:gone', name: 'gone', available: false }),
      ]}
      selected={['user:kb:physics']}
      status="ready"
      error={null}
      onToggle={onToggle}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      onManage={jest.fn()}
    />,
  );

  const ready = screen.getByLabelText('physics');
  expect(ready.props.accessibilityState).toEqual({ checked: true, disabled: false });

  const busy = screen.getByLabelText('bio');
  expect(busy.props.accessibilityState).toEqual({ checked: false, disabled: true });
  expect(screen.getByText('暂不可用（排队中）')).toBeTruthy();

  expect(screen.getByText('你已无法访问此知识库。')).toBeTruthy();

  fireEvent.press(ready);
  expect(onToggle).toHaveBeenCalledWith('user:kb:physics');
});

test('a selection the server no longer lists can still be removed', () => {
  const onToggle = jest.fn();
  render(
    <KnowledgePicker
      visible
      bases={[base()]}
      selected={['user:kb:physics', 'user:kb:deleted']}
      status="ready"
      error={null}
      onToggle={onToggle}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      onManage={jest.fn()}
    />,
  );

  // The handle is shown as a name, and the row stays pressable so the stale
  // choice can be dropped instead of riding along with every question.
  const stale = screen.getByLabelText('deleted');
  expect(stale.props.accessibilityState).toEqual({ checked: true, disabled: false });
  expect(
    screen.getByText('此知识库已不存在，点按即可取消选择。'),
  ).toBeTruthy();
  fireEvent.press(stale);
  expect(onToggle).toHaveBeenCalledWith('user:kb:deleted');
});

test('the picker offers management and a retry only when loading failed', () => {
  const onManage = jest.fn();
  const onRefresh = jest.fn();
  render(
    <KnowledgePicker
      visible
      bases={[]}
      selected={[]}
      status="failed"
      error="无法连接服务器。"
      onToggle={jest.fn()}
      onClose={jest.fn()}
      onRefresh={onRefresh}
      onManage={onManage}
    />,
  );
  expect(screen.getByText('无法连接服务器。')).toBeTruthy();
  fireEvent.press(button('管理'));
  fireEvent.press(button('重试'));
  expect(onManage).toHaveBeenCalledTimes(1);
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
