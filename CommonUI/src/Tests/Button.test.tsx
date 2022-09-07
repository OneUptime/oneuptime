import React from 'react';
import { create } from 'react-test-renderer';
import Button from '../Components/Button/Button';

describe('Button', () => {
    const button = create(<Button />);

    test('should match snapshot', () => {
        expect(button.toJSON()).toMatchInlineSnapshot(`
            <button
              className="btn no-border-on-hover btn waves-effect waves-light no-border-on-hover"
              onClick={[Function]}
              type="button"
            >
              <div>
                <div>
                  <div />
                </div>
                <span
                  className="justify-center"
                >
                  <span />
                  <span
                    style={
                      Object {
                        "marginLeft": "5px",
                      }
                    }
                  />
                </span>
              </div>
            </button>
        `);
    });
});
