import { ASK_SENTINEL, parseAsk } from './ask-protocol';

const ask = (obj: object) => `${ASK_SENTINEL} ${JSON.stringify(obj)}`;

describe('parseAsk', () => {
  it('валидный маркер → ask + текст без маркера', () => {
    const text =
      'Какой вариант предпочитаешь?\n' +
      ask({ question: 'Выбери', options: ['A', 'B', 'C'] });
    const r = parseAsk(text);
    expect(r.ask).toEqual({ question: 'Выбери', options: ['A', 'B', 'C'] });
    expect(r.text).toBe('Какой вариант предпочитаешь?');
  });

  it('нет маркера → ask undefined, текст цел', () => {
    const r = parseAsk('просто ответ без вопроса');
    expect(r.ask).toBeUndefined();
    expect(r.text).toBe('просто ответ без вопроса');
  });

  it('битый JSON → ask undefined, текст цел', () => {
    const text = 'ответ\n' + ASK_SENTINEL + ' {не json}';
    const r = parseAsk(text);
    expect(r.ask).toBeUndefined();
    expect(r.text).toBe(text);
  });

  it('менее 2 вариантов → undefined', () => {
    const text = 'q\n' + ask({ question: 'x', options: ['one'] });
    expect(parseAsk(text).ask).toBeUndefined();
  });

  it('более 6 вариантов → undefined', () => {
    const text =
      'q\n' + ask({ question: 'x', options: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(parseAsk(text).ask).toBeUndefined();
  });

  it('options не массив строк → undefined', () => {
    const text = 'q\n' + ask({ question: 'x', options: [1, 2] });
    expect(parseAsk(text).ask).toBeUndefined();
  });

  it('пустой question → undefined', () => {
    const text = 'q\n' + ask({ question: '   ', options: ['A', 'B'] });
    expect(parseAsk(text).ask).toBeUndefined();
  });

  it('ловит ПОСЛЕДНИЙ маркер, ранний в тексте игнорируется как часть текста', () => {
    const text =
      'строка с ' +
      ASK_SENTINEL +
      ' в середине\n' +
      ask({ question: 'Выбор', options: ['да', 'нет'] });
    const r = parseAsk(text);
    expect(r.ask).toEqual({ question: 'Выбор', options: ['да', 'нет'] });
    expect(r.text).toBe('строка с ' + ASK_SENTINEL + ' в середине');
  });
});
