import initStoryshots from '@storybook/addon-storyshots';

initStoryshots({ /* configuration options */ });

const constantDate = new Date('2017-06-13T04:41:20')

/*eslint no-global-assign:off*/
Date = class extends Date {
  constructor() {
    super();
    return constantDate
  }
}

const DATE_TO_USE = new Date('2016');
const _Date = Date;
global.Date = jest.fn(() => DATE_TO_USE);
global.Date.UTC = _Date.UTC;
global.Date.parse = _Date.parse;
global.Date.now = _Date.now;