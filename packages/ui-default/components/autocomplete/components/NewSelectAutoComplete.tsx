import type { ProblemDoc } from 'hydrooj/src/interface';
import PropTypes from 'prop-types';
import Select, { Option } from 'rc-select';
import React, { forwardRef } from 'react';
import { api, gql, request } from 'vj/utils';

const ProblemSelectAutoComplete = forwardRef<AutoCompleteHandle<ProblemDoc>, AutoCompleteProps<ProblemDoc>>((props, ref) => (
  <Select
    ref={ref as any}
    tokenSeparators={[',','，']}
    onSearch={(query) => request.get(`/d/${UiContext.domainId}/problem/list`, { prefix: query })}

  
  
  
  <AutoComplete<ProblemDoc>
    ref={ref as any}
    cacheKey={`problem-${UiContext.domainId}`}
    queryItems={(query) => request.get(`/d/${UiContext.domainId}/problem/list`, { prefix: query })}
    fetchItems={(ids) => api(gql`
      problems(ids: ${ids.map((i) => +i)}) {
        docId
        pid
        title
      }
    `, ['data', 'problems'])}
    itemText={(pdoc) => `${`${pdoc.docId} ${pdoc.title}`}`}
    itemKey={(pdoc) => `${pdoc.docId || pdoc}`}
    renderItem={(pdoc) => (
      <div className="media">
        <div className="media__body medium">
          <div className="problem-select__name">{pdoc.pid ? `${pdoc.pid} ` : ''}{pdoc.title}</div>
          <div className="problem-select__id">ID = {pdoc.docId}</div>
        </div>
      </div>
    )}
    {...props}
  />
));

ProblemSelectAutoComplete.propTypes = {
  width: PropTypes.string,
  height: PropTypes.string,
  listStyle: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  multi: PropTypes.bool,
  selectedKeys: PropTypes.arrayOf(PropTypes.string),
  allowEmptyQuery: PropTypes.bool,
  freeSolo: PropTypes.bool,
  freeSoloConverter: PropTypes.func,
};

ProblemSelectAutoComplete.defaultProps = {
  width: '100%',
  height: 'auto',
  listStyle: {},
  multi: false,
  selectedKeys: [],
  allowEmptyQuery: false,
  freeSolo: false,
  freeSoloConverter: (input) => input,
};

ProblemSelectAutoComplete.displayName = 'ProblemSelectAutoComplete';

export default ProblemSelectAutoComplete;
