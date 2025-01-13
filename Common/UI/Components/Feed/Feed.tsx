import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  id: string
}

const Feed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flow-root" id={props.id}>
    <ul role="list" className="-mb-8">
      <li>
        <div className="relative pb-8">
          <span className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true"></span>
          <div className="relative flex items-start space-x-3">
            <div className="relative">
              <img className="flex size-10 items-center justify-center rounded-full bg-gray-400 ring-8 ring-white" src="https://images.unsplash.com/photo-1520785643438-5bf77931f493?ixlib=rb-=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=8&w=256&h=256&q=80" alt=""/>
  
              <span className="absolute -bottom-0.5 -right-1 rounded-tl bg-white px-0.5 py-px">
                <svg className="size-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon">
                  <path fill-rule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
                </svg>
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div>
                <div className="text-sm">
                  <a href="#" className="font-medium text-gray-900">Eduardo Benz</a>
                </div>
                <p className="mt-0.5 text-sm text-gray-500">Commented 6d ago</p>
              </div>
              <div className="mt-2 text-sm text-gray-700">
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tincidunt nunc ipsum tempor purus vitae id. Morbi in vestibulum nec varius. Et diam cursus quis sed purus nam.</p>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li>
        <div className="relative pb-8">
          <span className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true"></span>
          <div className="relative flex items-start space-x-3">
            <div>
              <div className="relative px-1">
                <div className="flex size-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                  <svg className="size-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10 12a5.99 5.99 0 0 0-4.793 2.39A6.483 6.483 0 0 0 10 16.5a6.483 6.483 0 0 0 4.793-2.11A5.99 5.99 0 0 0 10 12Z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1 py-1.5">
              <div className="text-sm text-gray-500">
                <a href="#" className="font-medium text-gray-900">Hilary Mahy</a>
                assigned
                <a href="#" className="font-medium text-gray-900">Kristin Watson</a>
                <span className="whitespace-nowrap">2d ago</span>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li>
        <div className="relative pb-8">
          <span className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true"></span>
          <div className="relative flex items-start space-x-3">
            <div>
              <div className="relative px-1">
                <div className="flex size-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                  <svg className="size-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon">
                    <path fill-rule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v3.879a2.5 2.5 0 0 0 .732 1.767l7.5 7.5a2.5 2.5 0 0 0 3.536 0l3.878-3.878a2.5 2.5 0 0 0 0-3.536l-7.5-7.5A2.5 2.5 0 0 0 8.38 2H4.5ZM5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1 py-0">
              <div className="text-sm/8 text-gray-500">
                <span className="mr-0.5">
                  <a href="#" className="font-medium text-gray-900">Hilary Mahy</a>
                  added tags
                </span>
                <span className="mr-0.5">
                  <a href="#" className="inline-flex items-center gap-x-1.5 rounded-full px-2 py-1 text-xs font-medium text-gray-900 ring-1 ring-inset ring-gray-200">
                    <svg className="size-1.5 fill-red-500" viewBox="0 0 6 6" aria-hidden="true">
                      <circle cx="3" cy="3" r="3" />
                    </svg>
                    Bug
                  </a>
                  <a href="#" className="inline-flex items-center gap-x-1.5 rounded-full px-2 py-1 text-xs font-medium text-gray-900 ring-1 ring-inset ring-gray-200">
                    <svg className="size-1.5 fill-indigo-500" viewBox="0 0 6 6" aria-hidden="true">
                      <circle cx="3" cy="3" r="3" />
                    </svg>
                    Accessibility
                  </a>
                </span>
                <span className="whitespace-nowrap">6h ago</span>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li>
        <div className="relative pb-8">
          <div className="relative flex items-start space-x-3">
            <div className="relative">
              <img className="flex size-10 items-center justify-center rounded-full bg-gray-400 ring-8 ring-white" src="https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?ixlib=rb-=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=8&w=256&h=256&q=80" alt=""/>
  
              <span className="absolute -bottom-0.5 -right-1 rounded-tl bg-white px-0.5 py-px">
                <svg className="size-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon">
                  <path fill-rule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
                </svg>
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div>
                <div className="text-sm">
                  <a href="#" className="font-medium text-gray-900">Jason Meyers</a>
                </div>
                <p className="mt-0.5 text-sm text-gray-500">Commented 2h ago</p>
              </div>
              <div className="mt-2 text-sm text-gray-700">
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tincidunt nunc ipsum tempor purus vitae id. Morbi in vestibulum nec varius. Et diam cursus quis sed purus nam. Scelerisque amet elit non sit ut tincidunt condimentum. Nisl ultrices eu venenatis diam.</p>
              </div>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>);
};

export default Feed;
