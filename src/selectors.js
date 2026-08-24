// Single source of truth for every DOM selector.
// Arrays are fallback chains: resilient selectors first, proven-but-fragile last.
// When the site changes, this file is the only place to edit.

export const URLS = {
  login:
    'https://auth.paas.dana.id/#/cloudauth/login?goto=https:%2F%2Fmonitor.paas.dana.id%2Foptimus%2F%23%2Fauth',
  optimus: 'https://monitor.paas.dana.id/optimus/',
};

export const LOGIN = {
  email: [
    '.login-form-cnt input[type="email"]',
    '.login-form-cnt input[ng-model]',
    'body > div.fc-body.ng-scope > div > section > div:nth-child(2) > div > div > section > form > div.login-form-cnt > div:nth-child(2) > div > input',
  ],
  password: [
    '.login-form-cnt input[type="password"]',
    'body > div.fc-body.ng-scope > div > section > div:nth-child(2) > div > div > section > form > div.login-form-cnt > div:nth-child(3) > div > input',
  ],
  submit: [
    '.login-form-cnt button[type="submit"]',
    '.login-form-cnt button',
    'body > div.fc-body.ng-scope > div > section > div:nth-child(2) > div > div > section > form > div.login-form-cnt > div:nth-child(4) > button',
  ],
};

export const DASHBOARD = {
  // Workspace "select Production" modal — two generations, both seen in the wild.
  productionModal1: {
    option:
      'body > div.modal.ng-scope.top > div.modal-dialog.zoom > div > div > div.modal-body.ng-scope > div.ng-pristine.ng-invalid.ng-invalid-required > div:nth-child(2) > div > fc-radio-group > fc-radio:nth-child(3)',
    submit:
      'body > div.modal.ng-scope.top > div.modal-dialog.zoom > div > div > div.modal-footer > button',
  },
  productionModal2: {
    optionA:
      'body > div:nth-child(24) > div > div.ant-modal-wrap > div > div.ant-modal-content > div.ant-modal-body > div.antcloud-ui.app-select-projectworkspace > div.ant-row.app-select-workspace > div:nth-child(2) > div > label:nth-child(2) > span.ant-radio > input',
    optionB:
      'body > div:nth-child(24) > div > div.ant-modal-wrap > div > div.ant-modal-content > div.ant-modal-body > div.antcloud-ui.app-select-projectworkspace > div.ant-row.app-select-workspace > div:nth-child(1) > div > label:nth-child(2) > span.ant-radio > input',
    submit:
      'body > div:nth-child(24) > div > div.ant-modal-wrap > div > div.ant-modal-content > div.ant-modal-footer > button',
  },
  // Today's DOM: chart titles are bare spans with ng-click (audit 2026-08-19);
  // the h3.chart-title wrapper is legacy, kept as last fallback.
  chartTitle: ["span[ng-click='click();']", "span[ng-click='click()']", 'h3.chart-title span'],
  tabs: ['fc-tab-item', '[role="tab"]'],
  // Detail view is open ⇔ these tabs exist (they never exist on the dashboard list).
  detailTabs: 'fc-tab-item, [role="tab"]',
};

export const COMPARE = {
  modal: 'div[ng-show="1 === typeahead.selectId"]',
  date1: 'input[ng-model="queryInfo.day1"]',
  date2: 'input[ng-model="queryInfo.day2"]',
  startTime: 'input[ng-model="queryInfo.startTime"]',
  endTime: 'input[ng-model="queryInfo.endTime"]',
  compareBtn: 'button[ng-click="compare()"]',
};

export const POPUP = {
  link: ['.xf-pop-up-container h3 a', '.xf-pop-up-container a'],
  statWrapper: '.xf-line-chart-stat-wrapper',
  tableRows: '.xf-line-chart-stat-wrapper .xf-table tbody tr',
  close: 'div.xf-pop-up-close',
};
