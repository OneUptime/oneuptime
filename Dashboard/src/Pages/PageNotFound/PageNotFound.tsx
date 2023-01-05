import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import NotFound from "CommonUI/src/Components/404"

const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={'Page Not Found'} breadcrumbLinks={[]}>
            {/* <NotFound/> */}
            <main className="mx-auto max-w-7xl pb-10 lg:py-12 lg:px-8">
                <nav className="flex mb-12 text-right" aria-label="Breadcrumb">
                    <ol role="list" className="flex items-center space-x-4">
                        <li>
                            <div>
                                <a href="#" className="text-gray-400 hover:text-gray-500">

                                    <svg className="h-5 w-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                        <path fill-rule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" clip-rule="evenodd" />
                                    </svg>
                                    <span className="sr-only">Home</span>
                                </a>
                            </div>
                        </li>

                        <li>
                            <div className="flex items-center">

                                <svg className="h-5 w-5 flex-shrink-0 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                                </svg>
                                <a href="#" className="ml-4 text-sm font-medium text-gray-500 hover:text-gray-700">Projects</a>
                            </div>
                        </li>

                        <li>
                            <div className="flex items-center">

                                <svg className="h-5 w-5 flex-shrink-0 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                                </svg>
                                <a href="#" className="ml-4 text-sm font-medium text-gray-500 hover:text-gray-700" aria-current="page">Project Nero</a>
                            </div>
                        </li>
                    </ol>
                </nav>
                <div className="lg:grid lg:grid-cols-12 lg:gap-x-5">
                    <aside className="py-6 px-2 sm:px-6 lg:col-span-3 lg:py-0 lg:px-0">
                        <nav className="space-y-1">

                            <a href="#" className="text-gray-500 hover:text-gray-900 hover:bg-gray-50 group rounded-md px-3 py-2 flex items-center text-sm font-medium">

                                <svg className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="truncate">Profile</span>
                            </a>

                            <a href="#" className="text-gray-500 hover:text-gray-900 hover:bg-gray-50 group rounded-md px-3 py-2 flex items-center text-sm font-medium">

                                <svg className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12m6.894 5.785l-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864l-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                                </svg>
                                <span className="truncate">Account</span>
                            </a>

                            <a href="#" className="text-gray-500 hover:text-gray-900 hover:bg-gray-50 group rounded-md px-3 py-2 flex items-center text-sm font-medium">

                                <svg className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                                </svg>
                                <span className="truncate">Password</span>
                            </a>

                            <a href="#" className="text-gray-500 hover:text-gray-900 hover:bg-gray-50 group rounded-md px-3 py-2 flex items-center text-sm font-medium">

                                <svg className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                                </svg>
                                <span className="truncate">Notifications</span>
                            </a>

                            <a href="#" className="bg-gray-50 text-slate-900 hover:bg-white group rounded-md px-3 py-2 flex items-center text-sm font-medium" aria-current="page">

                                <svg className="text-slate-900 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                                </svg>
                                <span className="truncate">Plan &amp; Billing</span>
                            </a>

                            <a href="#" className="text-gray-500 hover:text-gray-900 hover:bg-gray-50 group rounded-md px-3 py-2 flex items-center text-sm font-medium">

                                <svg className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-1 mr-3 h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
                                </svg>
                                <span className="truncate">Integrations</span>
                            </a>
                        </nav>
                    </aside>

                    


                    <div className="space-y-6 sm:px-6 lg:col-span-9 lg:px-0">
                        <section aria-labelledby="payment-details-heading">
                            <form action="#" method="POST">
                                <div className="shadow sm:overflow-hidden sm:rounded-md">
                                    <div className="bg-white py-6 px-4 sm:p-6">
                                        <div>
                                            <h2 id="payment-details-heading" className="text-lg font-medium leading-6 text-gray-900">Payment details</h2>
                                            <p className="mt-1 text-sm text-gray-500">Update your billing information. Please note that updating your location could affect your tax rates.</p>
                                        </div>

                                        <div className="mt-6 grid grid-cols-4 gap-6">
                                            <div className="col-span-4 sm:col-span-2">
                                                <label className="block text-sm font-medium text-gray-700">First name</label>
                                                <input type="text" name="first-name" id="first-name" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" />
                                            </div>

                                            <div className="col-span-4 sm:col-span-2">
                                                <label className="block text-sm font-medium text-gray-700">Last name</label>
                                                <input type="text" name="last-name" id="last-name" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" />
                                            </div>

                                            <div className="col-span-4 sm:col-span-2">
                                                <label className="block text-sm font-medium text-gray-700">Email address</label>
                                                <input type="text" name="email-address" id="email-address" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" />
                                            </div>

                                            <div className="col-span-4 sm:col-span-1">
                                                <label className="block text-sm font-medium text-gray-700">Expration date</label>
                                                <input type="text" name="expiration-date" id="expiration-date" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" placeholder="MM / YY" />
                                            </div>

                                            <div className="col-span-4 sm:col-span-1">
                                                <label className="flex items-center text-sm font-medium text-gray-700">
                                                    <span>Security code</span>

                                                    <svg className="ml-1 h-5 w-5 flex-shrink-0 text-gray-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                                                    </svg>
                                                </label>
                                                <input type="text" name="security-code" id="security-code" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" />
                                            </div>

                                            <div className="col-span-4 sm:col-span-2">
                                                <label className="block text-sm font-medium text-gray-700">Country</label>
                                                <select id="country" name="country" className="mt-1 block w-full rounded-md border border-gray-300 bg-white py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm">
                                                    <option>United States</option>
                                                    <option>Canada</option>
                                                    <option>Mexico</option>
                                                </select>
                                            </div>

                                            <div className="col-span-4 sm:col-span-2">
                                                <label for="postal-code" className="block text-sm font-medium text-gray-700">ZIP / Postal code</label>
                                                <input type="text" name="postal-code" id="postal-code" className="mt-1 block w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-gray-900 sm:text-sm" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 px-4 py-3 text-right sm:px-6">
                                        <button type="submit" className="inline-flex justify-center rounded-md border border-transparent bg-gray-800 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2">Save</button>
                                    </div>
                                </div>
                            </form>
                        </section>


                        <section aria-labelledby="plan-heading">
                            <form action="#" method="POST">
                                <div className="shadow sm:overflow-hidden sm:rounded-md">
                                    <div className="space-y-6 bg-white py-6 px-4 sm:p-6">
                                        <div>
                                            <h2 id="plan-heading" className="text-lg font-medium leading-6 text-gray-900">Plan</h2>
                                        </div>

                                        <fieldset>
                                            <legend className="sr-only">Pricing plans</legend>
                                            <div className="relative -space-y-px rounded-md bg-white">

                                                <label className="rounded-tl-md rounded-tr-md relative border p-4 flex flex-col cursor-pointer md:pl-4 md:pr-6 md:grid md:grid-cols-3 focus:outline-none">
                                                    <span className="flex items-center text-sm">
                                                        <input type="radio" name="pricing-plan" value="Startup" className="h-4 w-4 text-slate-500 border-gray-300 focus:ring-gray-900" aria-labelledby="pricing-plans-0-label" aria-describedby="pricing-plans-0-description-0 pricing-plans-0-description-1" />
                                                        <span id="pricing-plans-0-label" className="ml-3 font-medium text-gray-900">Startup</span>
                                                    </span>
                                                    <span id="pricing-plans-0-description-0" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-center">

                                                        <span className="font-medium">$29 / mo</span>

                                                        <span>($290 / yr)</span>
                                                    </span>

                                                    <span id="pricing-plans-0-description-1" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-right">Up to 5 active job postings</span>
                                                </label>


                                                <label className="relative border p-4 flex flex-col cursor-pointer md:pl-4 md:pr-6 md:grid md:grid-cols-3 focus:outline-none">
                                                    <span className="flex items-center text-sm">
                                                        <input type="radio" name="pricing-plan" value="Business" className="h-4 w-4 text-slate-500 border-gray-300 focus:ring-gray-900" aria-labelledby="pricing-plans-1-label" aria-describedby="pricing-plans-1-description-0 pricing-plans-1-description-1" />
                                                        <span id="pricing-plans-1-label" className="ml-3 font-medium text-gray-900">Business</span>
                                                    </span>
                                                    <span id="pricing-plans-1-description-0" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-center">

                                                        <span className="font-medium">$99 / mo</span>

                                                        <span>($990 / yr)</span>
                                                    </span>

                                                    <span id="pricing-plans-1-description-1" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-right">Up to 25 active job postings</span>
                                                </label>


                                                <label className="rounded-bl-md rounded-br-md relative border p-4 flex flex-col cursor-pointer md:pl-4 md:pr-6 md:grid md:grid-cols-3 focus:outline-none">
                                                    <span className="flex items-center text-sm">
                                                        <input type="radio" name="pricing-plan" value="Enterprise" className="h-4 w-4 text-slate-500 border-gray-300 focus:ring-gray-900" aria-labelledby="pricing-plans-2-label" aria-describedby="pricing-plans-2-description-0 pricing-plans-2-description-1" />
                                                        <span id="pricing-plans-2-label" className="ml-3 font-medium text-gray-900">Enterprise</span>
                                                    </span>
                                                    <span id="pricing-plans-2-description-0" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-center">

                                                        <span className="font-medium">$249 / mo</span>

                                                        <span>($2490 / yr)</span>
                                                    </span>

                                                    <span id="pricing-plans-2-description-1" className="ml-6 pl-1 text-sm md:ml-0 md:pl-0 md:text-right">Unlimited active job postings</span>
                                                </label>
                                            </div>
                                        </fieldset>

                                        <div className="flex items-center">

                                            <button type="button" className="bg-gray-200 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2" role="switch" aria-checked="true" aria-labelledby="annual-billing-label">

                                                <span aria-hidden="true" className="translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
                                            </button>
                                            <span className="ml-3" id="annual-billing-label">
                                                <span className="text-sm font-medium text-gray-900">Annual billing</span>
                                                <span className="text-sm text-gray-500">(Save 10%)</span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 px-4 py-3 text-right sm:px-6">
                                        <button type="submit" className="inline-flex justify-center rounded-md border border-transparent bg-gray-800 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2">Save</button>
                                    </div>
                                </div>
                            </form>
                        </section>


                        <section aria-labelledby="billing-history-heading">
                            <div className="bg-white pt-6 shadow sm:overflow-hidden sm:rounded-md">
                                <div className="px-4 sm:px-6">
                                    <h2 id="billing-history-heading" className="text-lg font-medium leading-6 text-gray-900">Billing history</h2>
                                </div>
                                <div className="mt-6 flex flex-col">
                                    <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                                        <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                                            <div className="overflow-hidden border-t border-gray-200">
                                                <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                                                            <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Description</th>
                                                            <th scope="col" className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Amount</th>

                                                            <th scope="col" className="relative px-6 py-3 text-left text-sm font-medium text-gray-500">
                                                                <span className="sr-only">View receipt</span>
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-200 bg-white">
                                                        <tr>
                                                            <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                                                                <time>1/1/2020</time>
                                                            </td>
                                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">Business Plan - Annual Billing</td>
                                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">CA$109.00</td>
                                                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                                                                <a href="#" className="text-slate-600 hover:text-slate-900">View receipt</a>
                                                            </td>
                                                        </tr>


                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </Page>
    );
};

export default PageNotFound;
