import * as api from '../api'
import axiosMock from './axios_mock'
import {
  API_URL
} from '../config'

localStorage.setItem('user','test')
localStorage.setItem('access_token','test')



describe('Delete API', () => {
  
  it('should fail with 404', () => {
    
    let test = api.deleteApi(`deleteApi`)

      return test.catch(e => {
          expect(e).toEqual(Error('Request failed with status code 404'))
          expect(localStorage.getItem('user')).toEqual('test')
      })
  })

  it('should fail with 401, clear user in storage', () => {

    axiosMock.onDelete(`${API_URL}/deleteApi`).reply(401, {data:{}}, {});
    
    let test = api.deleteApi(`deleteApi`)

      return test.catch(e => {
        expect(localStorage.getItem('user')).toEqual(null)
          expect(e).toEqual({})
      })
  })

  it('should return 200 return []', () => {

    axiosMock.onDelete(`${API_URL}/deleteApi`).reply(200, [], {});
    
    let test = api.deleteApi(`deleteApi`)

      return test.then(o => {
         expect(o.data).toEqual([])
      })
  })

})

describe('Post API', () => {
  it('should fail with 404', () => {
    
    let test = api.postApi(`postApi`)

      return test.catch(e => {
          expect(e).toEqual(Error('Request failed with status code 404'))
          
      })
  })

  it('should fail with 401, clear user in storage', () => {

    axiosMock.onPost(`${API_URL}/postApi`).reply(401, {data:{}}, {});
    
    let test = api.postApi(`postApi`)

      return test.catch(e => {
        expect(localStorage.getItem('user')).toEqual(null)
          expect(e).toEqual({})
      })
  })

  it('should return 200 return []', () => {

    axiosMock.onPost(`${API_URL}/postApi`).reply(200, [], {});
    
    let test = api.postApi(`postApi`)

      return test.then(o => {
         expect(o.data).toEqual([])
      })
  })

})


describe('Get API', () => {
  it('should fail with 404', () => {
    
    let test = api.getApi(`getApi`)

      return test.catch(e => {
          expect(e).toEqual(Error('Request failed with status code 404'))
      })
  })

  it('should fail with 401, clear user in storage', () => {

    axiosMock.onGet(`${API_URL}/getApi`).reply(401, {data:{}}, {});
    
    let test = api.getApi(`getApi`)

      return test.catch(e => {
        expect(localStorage.getItem('user')).toEqual(null)
          expect(e).toEqual({})
      })
  })

  it('should return 200 return []', () => {

    axiosMock.onGet(`${API_URL}/getApi`).reply(200, [], {});
    
    let test = api.getApi(`getApi`)

      return test.then(o => {
         expect(o.data).toEqual([])
      })
  })

})

describe('Put API', () => {
  localStorage.setItem('access_token','test')
  it('should fail with 404', () => {
    
    let test = api.putApi(`putApi`)

      return test.catch(e => {
          expect(e).toEqual(Error('Request failed with status code 404'))
      })
  })

  it('should fail with 401, clear user in storage', () => {

    axiosMock.onPut(`${API_URL}/putApi`).reply(401, {data:{}}, {});
    
    let test = api.putApi(`putApi`)

      return test.catch(e => {
        expect(localStorage.getItem('user')).toEqual(null)
          expect(e).toEqual({})
      })
  })

  it('should return 200 return []', () => {

    axiosMock.onPut(`${API_URL}/putApi`).reply(200, [], {});
    
    let test = api.putApi(`putApi`)

      return test.then(o => {
         expect(o.data).toEqual([])
      })
  })

})
