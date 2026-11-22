(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, className = '', text) => {
    const element=document.createElement(tag);if(className)element.className=className;
    if(text!==undefined)element.textContent=String(text);return element;
  };
  const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  const products=[
    {sku:'EQ-100',name:'Kit de instalação',price:15990,category:'Equipamentos',minimum:6},
    {sku:'EQ-105',name:'Leitor compacto',price:48900,category:'Equipamentos',minimum:4},
    {sku:'IN-200',name:'Conector industrial',price:3500,category:'Insumos',minimum:12},
    {sku:'IN-220',name:'Sensor de presença',price:11900,category:'Insumos',minimum:8},
    {sku:'AC-310',name:'Suporte modular',price:7900,category:'Acessórios',minimum:5},
    {sku:'AC-340',name:'Cabo técnico 2m',price:2900,category:'Acessórios',minimum:10}
  ];
  const initial={central:[48,15,95,24,33,70],filial:[12,5,18,9,14,22]};
  let balances={},cart=new Map(),orders=[],movements=[],sequence=1;
  const current=()=>$('warehouse').value;
  const alert=message=>{$('notice').textContent=message;};
  function record(warehouse,sku,physical,reserved,kind,orderId=null){
    movements.push({warehouse,sku,physical,reserved,kind,orderId});
  }
  function reset(){
    balances={};cart=new Map();orders=[];movements=[];sequence=1;
    for(const [warehouse,quantities] of Object.entries(initial)){
      balances[warehouse]={};
      products.forEach((product,index)=>{balances[warehouse][product.sku]={onHand:quantities[index],reserved:0};});
    }
    render();
  }
  function getPrice(sku){return products.find(item=>item.sku===sku)?.price||0;}
  function addLine(){
    const sku=$('sku').value,quantity=Number($('quantity').value);
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>50){alert('Quantidade entre 1 e 50 unidades.');return;}
    const existing=cart.get(sku)||0;
    if(existing+quantity>50){alert('Máximo de 50 unidades por SKU.');return;}
    cart.set(sku,existing+quantity);renderCart();
  }
  function renderCart(){
    const target=$('cart-list');target.replaceChildren();
    if(!cart.size)target.append(make('p','','Nenhum item na cesta.'));
    for(const [sku,quantity] of cart){
      const row=make('div','cart-line');row.append(make('span','',`${sku} · ${quantity} un. · ${money(getPrice(sku)*quantity)}`));
      const remove=make('button','','Remover');remove.type='button';remove.addEventListener('click',()=>{cart.delete(sku);renderCart();});
      row.append(remove);target.append(row);
    }
    $('estimate').textContent=money([...cart].reduce((sum,[sku,quantity])=>sum+getPrice(sku)*quantity,0));
  }
  function reserve(){
    if(!cart.size){alert('Adicione ao menos um produto à cesta.');return;}
    const warehouse=current(),items=[...cart].map(([sku,quantity])=>({sku,quantity}));
    for(const {sku,quantity} of items){
      const balance=balances[warehouse][sku];
      if(!balance||balance.onHand-balance.reserved<quantity){
        alert(`Reserva recusada: saldo insuficiente para ${sku}. Nenhuma linha foi alterada.`);return;
      }
    }
    const total=items.reduce((sum,item)=>sum+getPrice(item.sku)*item.quantity,0);
    const order={id:`PD-DEMO-${String(sequence++).padStart(4,'0')}`,items,warehouse,total,
                 status:'reserved',version:1,returns:{},history:['Cesta reservada']};
    items.forEach(item=>{
      balances[warehouse][item.sku].reserved+=item.quantity;
      record(warehouse,item.sku,0,item.quantity,'reserve',order.id);
    });
    orders.unshift(order);cart=new Map();alert(`${order.id} reservado somente nesta sessão.`);render();
  }
  function transition(id,target){
    const order=orders.find(item=>item.id===id);if(!order)return;
    const allowed={reserved:['confirmed','cancelled'],confirmed:['dispatched','cancelled']};
    if(!(allowed[order.status]||[]).includes(target)){alert('Transição inválida.');return;}
    const warehouse=order.warehouse;
    for(const item of order.items){
      const balance=balances[warehouse][item.sku];
      if(target==='cancelled'){
        balance.reserved-=item.quantity;
        record(warehouse,item.sku,0,-item.quantity,'release',id);
      }
      if(target==='dispatched'){
        balance.reserved-=item.quantity;balance.onHand-=item.quantity;
        record(warehouse,item.sku,-item.quantity,-item.quantity,'dispatch',id);
      }
    }
    order.status=target;order.version++;order.history.push(target);
    alert(`${id}: ${target} registrado no histórico sintético.`);render();
  }
  function returnOne(id){
    const order=orders.find(item=>item.id===id);
    if(!order||order.status!=='dispatched')return;
    const available=order.items.find(item=>(order.returns[item.sku]||0)<item.quantity);
    if(!available){alert('Todos os itens já foram devolvidos.');return;}
    order.returns[available.sku]=(order.returns[available.sku]||0)+1;
    balances[order.warehouse][available.sku].onHand++;
    record(order.warehouse,available.sku,1,0,'return',order.id);
    order.history.push(`Devolução 1 un. ${available.sku}`);
    alert('Devolução parcial aplicada ao saldo físico sintético.');render();
  }
  function transfer(){
    const source=current(),target=source==='central'?'filial':'central';
    const sku=$('transfer-sku').value,quantity=Number($('transfer-qty').value);
    const stock=balances[source][sku];
    if(!Number.isInteger(quantity)||quantity<1||quantity>100||stock.onHand-stock.reserved<quantity){
      alert('Transferência recusada: quantidade inválida ou não disponível.');return;
    }
    stock.onHand-=quantity;balances[target][sku].onHand+=quantity;
    record(source,sku,-quantity,0,'transfer_out');record(target,sku,quantity,0,'transfer_in');
    alert(`${quantity} unidade(s) de ${sku} transferidas de ${source} para ${target} nesta simulação.`);render();
  }
  function adjust(){
    const sku=$('adjust-sku').value,delta=Number($('adjust-delta').value),warehouse=current();
    const reason=$('adjust-reason').value.trim(),balance=balances[warehouse][sku];
    if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>100||reason.length<5){
      alert('Ajuste inválido: informe variação não nula e motivo.');return;
    }
    if(balance.onHand+delta<balance.reserved){alert('Ajuste recusado: comprometeria unidades reservadas.');return;}
    balance.onHand+=delta;record(warehouse,sku,delta,0,'adjustment');
    alert(`Ajuste ${delta>0?'+':''}${delta} de ${sku} aplicado: ${reason}.`);render();
  }
  function reconcile(){
    const warehouse=current();let errors=0;
    products.forEach((product,index)=>{
      const changes=movements.filter(m=>m.warehouse===warehouse&&m.sku===product.sku);
      const physical=changes.reduce((sum,m)=>sum+m.physical,initial[warehouse][index]);
      const reserved=changes.reduce((sum,m)=>sum+m.reserved,0);
      const real=balances[warehouse][product.sku];
      if(physical!==real.onHand||reserved!==real.reserved)errors++;
    });
    const target=$('ledger-status');target.className=errors?'ledger-error':'ledger-ok';
    target.textContent=errors?`${errors} divergência(s) encontrada(s)`:'6 SKUs conciliados · nenhuma divergência';
    alert(errors?'Revisão de saldos identificou inconsistências.':'Saldo físico e reservado conciliados com os movimentos da simulação.');
  }
  function selectOptions(){
    for(const id of ['sku','transfer-sku','adjust-sku']){
      const select=$(id),previous=select.value;select.replaceChildren();
      products.forEach(product=>{const option=make('option','',`${product.name} — ${product.sku}`);option.value=product.sku;select.append(option);});
      if(products.some(product=>product.sku===previous))select.value=previous;
    }
  }
  function render(){
    const warehouse=current(),list=products.map(p=>({...p,...balances[warehouse][p.sku]}));
    $('available').textContent=list.reduce((sum,p)=>sum+p.onHand-p.reserved,0);
    $('reserved').textContent=list.reduce((sum,p)=>sum+p.reserved,0);
    $('active').textContent=orders.filter(order=>order.warehouse===warehouse&&['reserved','confirmed'].includes(order.status)).length;
    $('alerts').textContent=list.filter(p=>p.onHand-p.reserved<p.minimum).length;
    const body=$('stock');body.replaceChildren();
    list.forEach(product=>{
      const row=make('tr');
      [product.name,product.sku,product.onHand,product.reserved,product.onHand-product.reserved,money(product.price)]
        .forEach((value,index)=>{const cell=make('td',index===1?'sku':'',value);row.append(cell);});
      body.append(row);
    });
    selectOptions();renderCart();
    const target=$('order-list');target.replaceChildren();
    const visible=orders.filter(order=>order.warehouse===warehouse);
    if(!visible.length)target.append(make('p','','Nenhum pedido reservado. Crie uma cesta para testar o ciclo.'));
    visible.forEach(order=>{
      const row=make('div','order-row');
      const summary=make('div');summary.append(make('b','',order.id),
        make('small','',order.items.map(item=>`${item.sku} × ${item.quantity}`).join(' · ')));
      const detail=make('div');detail.append(make('b','',money(order.total)),make('small','',order.history.join(' → ')));
      row.append(summary,detail,make('span','state',order.status.toUpperCase()));
      const actions=make('div','buttons');
      for(const [targetStatus,label] of [['confirmed','Confirmar'],['dispatched','Expedir'],['cancelled','Cancelar']]){
        const button=make('button','',label);button.type='button';
        button.disabled=!({reserved:['confirmed','cancelled'],confirmed:['dispatched','cancelled']}[order.status]||[]).includes(targetStatus);
        button.addEventListener('click',()=>transition(order.id,targetStatus));actions.append(button);
      }
      if(order.status==='dispatched'){
        const returns=make('button','','Devolver 1 un.');returns.type='button';returns.addEventListener('click',()=>returnOne(order.id));actions.append(returns);
      }
      row.append(actions);target.append(row);
    });
    $('ledger-status').textContent='Verificação disponível';$('ledger-status').className='';
  }
  $('warehouse').addEventListener('change',()=>{cart=new Map();render();});
  $('order-form').addEventListener('submit',event=>{event.preventDefault();reserve();});
  $('add-line').addEventListener('click',addLine);
  $('transfer-form').addEventListener('submit',event=>{event.preventDefault();transfer();});
  $('adjust-form').addEventListener('submit',event=>{event.preventDefault();adjust();});
  $('ledger-check').addEventListener('click',reconcile);
  $('reset').addEventListener('click',()=>{reset();alert('Amostra sintética restaurada.');});
  reset();
})();
